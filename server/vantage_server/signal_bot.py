"""Reclaim signal bot — Telegram pushes driven by the paper-trading pipeline.

DELIBERATELY NOT a second signal engine. The paper pipeline already IS the
reclaim strategy end-to-end: tickets come from the playbook's levels
(paper.build_tickets), an entry waits for the validated discipline (3
consecutive 5m closes back through the level — reclaim_strategy.py), and
settle_open closes on the first target/stop touch. This module just DRIVES
that pipeline on a loop and notifies on its state transitions, so every
signal is automatically tracked in the Paper Trading section (source
"auto") and the numbers the bot reports are the numbers the track record
shows. Live executions taken from a signal are tracked separately by the
managed_positions book (Managed Exits view / GET /api/exits).

Transitions → pushes:

* session tickets armed  → 🎯 one summary per underlying per session
* reclaim CONFIRMED      → 🔔 the actual signal: entry/stop/target + paper id
* closed (target/stop)   → ✅/❌ outcome with P&L
* pending expired        → ⏳ quiet note (discipline said no trade)

Telegram: plain Bot API sendMessage over HTTPS (stdlib urllib, no new deps).
Configure env TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID; without them the bot
logs what it WOULD send and otherwise works normally (paper trades still
open/fill/close). Writes touch only our own SQLite + the outbound Telegram
message — no broker path, ADR-010's read-only doctrine is untouched.

Run continuously:  python -m vantage_server.signal_bot [interval_sec]
Run one pass:      POST /api/reclaim-bot/poll
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import time
import urllib.request

from . import paper
from .store import Store

log = logging.getLogger(__name__)

#: Underlyings the bot arms each session (every one with a nightly playbook).
BOT_UNDERLYINGS = ("SPX", "QQQ", "IWM")

TOKEN_ENV = "TELEGRAM_BOT_TOKEN"
CHAT_ENV = "TELEGRAM_CHAT_ID"


def telegram_configured() -> bool:
    return bool(os.environ.get(TOKEN_ENV)) and bool(os.environ.get(CHAT_ENV))


def send_telegram(text: str) -> bool:
    """Push one message. Unconfigured → log-only (returns False). Failures
    are logged, never raised — a missed notification must not stop the
    pipeline (the paper row still records the event)."""
    if not telegram_configured():
        log.info("[telegram unconfigured] %s", text)
        return False
    token = os.environ[TOKEN_ENV]
    payload = json.dumps({"chat_id": os.environ[CHAT_ENV], "text": text,
                          "disable_web_page_preview": True}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            ok = 200 <= res.status < 300
    except Exception as e:
        log.error("telegram send failed: %s", e)
        return False
    if not ok:
        log.error("telegram send failed: HTTP %s", res.status)
    return ok


# ── message rendering ─────────────────────────────────────────────────────────

def _fmt(v) -> str:
    return "—" if v is None else f"{float(v):g}"


def msg_armed(underlying: str, session: str | None, opened: list[dict]) -> str:
    lines = [f"🎯 {underlying} reclaim levels armed"
             + (f" · session {session}" if session else "")]
    for t in opened:
        lines.append(f"  {t['side']} {t['symbol']} on reclaim of "
                     f"{_fmt(t.get('spy_level'))} · stop {_fmt(t.get('spy_stop'))}"
                     f" · target {_fmt(t.get('spy_target'))} · paper #{t['id']}")
    return "\n".join(lines)


def msg_filled(t: dict) -> str:
    return (f"🔔 RECLAIM CONFIRMED — {str(t['side']).upper()} {t['symbol']} "
            f"@ {_fmt(t.get('spy_entry'))} (level {_fmt(t.get('spy_level'))})\n"
            f"  stop {_fmt(t.get('spy_stop'))} · target {_fmt(t.get('spy_target'))}"
            f" · paper #{t['id']}\n"
            f"  execute: Playbook → level {_fmt(t.get('spy_level'))} → Execute")


def msg_closed(t: dict) -> str:
    won = (t.get("pnl") or 0) > 0
    icon = "✅" if won else "❌"
    return (f"{icon} {t['symbol']} {t['side']} closed: {t.get('exit_reason')} "
            f"@ {_fmt(t.get('spy_exit'))} · P&L {float(t.get('pnl') or 0):+.2f} "
            f"({float(t.get('pnl_pct') or 0):+.2f}%) · paper #{t['id']}")


def msg_expired(t: dict) -> str:
    return (f"⏳ {t['symbol']} {t['side']} level {_fmt(t.get('spy_level'))} "
            f"expired unfilled — no reclaim, no trade · paper #{t['id']}")


# ── arming: today's tickets → auto paper trades ──────────────────────────────

def _ticket_key(row: dict) -> tuple:
    """Identity of one signal for dedupe: the session, proxy, side, and the
    level it keys off. Any prior row (open OR closed) with the same key means
    the signal is already tracked."""
    return (row.get("session"), row.get("symbol"), row.get("side"),
            round(float(row.get("spy_level") or row.get("spy_entry") or 0), 2))


def arm_session(store: Store, underlyings=BOT_UNDERLYINGS) -> list[dict]:
    """Open (source="auto") a pending paper trade for every reclaim ticket in
    each underlying's CURRENT playbook that isn't already tracked. Idempotent
    — re-running arms nothing new. Returns the newly opened rows."""
    known = {_ticket_key(r) for r in store.load_paper_trades()}
    opened: list[dict] = []
    for und in underlyings:
        row = store.load_spx_playbook(symbol=und)
        scaffold = (row or {}).get("scaffold")
        session = (row or {}).get("session")
        if not scaffold:
            continue
        view = paper.build_analysis(store, scaffold, underlying=und)
        fresh: list[dict] = []
        for t in view.get("tickets") or []:
            if t.get("entry_trigger") != "reclaim-3x5m":
                continue    # only the validated reclaim discipline signals
            probe = {"session": session, "symbol": t.get("symbol"),
                     "side": t.get("side"),
                     "spy_level": t.get("spy_level"), "spy_entry": t.get("spy_entry")}
            if _ticket_key(probe) in known:
                continue
            tid = paper.open_paper_trade(store, t, session=session, source="auto")
            rec = {**probe, "id": tid, "spy_stop": t.get("spy_stop"),
                   "spy_target": t.get("spy_target")}
            known.add(_ticket_key(probe))
            fresh.append(rec)
        if fresh:
            send_telegram(msg_armed(und, session, fresh))
            opened.extend(fresh)
    return opened


# ── polling: settle + diff + notify ──────────────────────────────────────────

def poll(store: Store) -> list[dict]:
    """One bot pass: arm anything new, advance the pipeline (settle_open),
    and push a Telegram message per state transition. Returns the event list
    (kind + trade row) for the API/tests."""
    events: list[dict] = []
    for rec in arm_session(store):
        events.append({"kind": "armed", "trade": rec})

    before = {t["id"]: (t.get("fill_status") or "filled", t["status"])
              for t in store.load_paper_trades("open")}
    if before:
        counts = paper.settle_open(store)
        log.info("settle: %s", counts)
    after = {t["id"]: t for t in store.load_paper_trades()}

    for tid, (fill_status, _status) in before.items():
        now = after.get(tid)
        if not now:
            continue
        if fill_status == "pending" and (now.get("fill_status") or "") == "filled" \
                and now["status"] == "open":
            send_telegram(msg_filled(now))
            events.append({"kind": "reclaim_confirmed", "trade": now})
        elif now["status"] == "closed":
            if now.get("exit_reason") == "never_filled":
                send_telegram(msg_expired(now))
                events.append({"kind": "expired", "trade": now})
            else:
                # pending→filled→closed within one pass still reports the fill
                if fill_status == "pending":
                    send_telegram(msg_filled(now))
                    events.append({"kind": "reclaim_confirmed", "trade": now})
                send_telegram(msg_closed(now))
                events.append({"kind": "closed", "trade": now})
    return events


# ── the loop ─────────────────────────────────────────────────────────────────

def market_open_now(now: _dt.datetime | None = None) -> bool:
    """Weekday 09:25–16:10 ET — 5m bars only move then; outside it the loop
    idles instead of hammering the bar feed."""
    now = now or _dt.datetime.now(paper.ET)
    if now.weekday() >= 5:
        return False
    minutes = now.hour * 60 + now.minute
    return (9 * 60 + 25) <= minutes <= (16 * 60 + 10)


def run_loop(store: Store, interval_sec: float = 60.0) -> None:  # pragma: no cover
    log.info("signal bot: %ss interval, telegram=%s",
             interval_sec, "on" if telegram_configured() else "LOG-ONLY")
    while True:
        started = time.time()
        if market_open_now():
            try:
                poll(store)
            except Exception as e:
                log.error("signal bot poll failed: %s", e)
        time.sleep(max(5.0, interval_sec - (time.time() - started)))


def main() -> None:  # pragma: no cover
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
    run_loop(Store(None), interval)


if __name__ == "__main__":  # pragma: no cover
    main()
