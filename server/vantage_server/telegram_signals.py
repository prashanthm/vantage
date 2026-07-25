"""Telegram signal channels → desk inbox → PAPER trades (ADR-010: no real
orders, ever). The listener daemon (telegram_listener.py) feeds every message
from the operator's allow-listed channels into ``ingest_message``; messages
that parse into a FULL signal (side + ticker + entry + stop + target, levels
coherent) auto-open a paper trade in the ``telegram`` book with the CHANNEL
as its strategy tag — each channel accumulates its own win-rate/PF record,
exactly like a scanner family. Anything partial or incoherent stays
inbox-only (visible, never traded). Deterministic regex parsing only — a
signal either matches the strict grammar or it does not trade (ADR-008:
code decides; no model in the execution path).

Settlement: first-touch stop/target on the last live price, stop-first on
ties — same conventions as the scanner book. Ticked by the signal-bot 60s
heartbeat (api reclaim-bot/poll) alongside level alerts.
"""
from __future__ import annotations

import datetime as _dt
import json
import re

from .store import Store

INBOX_KEY = "telegram_inbox"        # meta kv: capped list of recent messages
CHANNELS_KEY = "telegram_channels"  # meta kv: operator allow-list
DIALOGS_KEY = "telegram_dialogs"    # meta kv: the account's channel list (listener-published)
INBOX_CAP = 200
NOTIONAL_USD = 1000.0               # fixed sim size per signal (shares book)
BOOK = "telegram"

# ── the strict signal grammar ────────────────────────────────────────────────
_SIDE = re.compile(r"\b(BUY|LONG|SELL|SHORT)\b")
_TICKER = re.compile(r"\$([A-Z]{1,5})\b|(?:\b(?:BUY|LONG|SELL|SHORT)\b[:\s]+)([A-Z]{1,5})\b")
_ENTRY = re.compile(r"(?:\bENTRY\b|\bCMP\b|@)[:\s]*\$?(\d+(?:\.\d+)?)")
_TARGET = re.compile(r"(?:\bTARGET\b|\bTGT\b|\bTP1?\b|\bT1\b)[:\s]*\$?(\d+(?:\.\d+)?)")
_STOP = re.compile(r"(?:\bSTOP\s*LOSS\b|\bSTOPLOSS\b|\bSTOP\b|\bSL\b)[:\s]*\$?(\d+(?:\.\d+)?)")


def parse_signal(text: str) -> dict | None:
    """Parse one message into {side, symbol, entry, stop, target} or None.
    ALL five fields must parse and the levels must be coherent (long:
    stop < entry < target; short mirrored) — partial signals never trade."""
    t = (text or "").upper()
    m_side = _SIDE.search(t)
    m_tick = _TICKER.search(t)
    m_entry = _ENTRY.search(t)
    m_tgt = _TARGET.search(t)
    m_stop = _STOP.search(t)
    if not (m_side and m_tick and m_entry and m_tgt and m_stop):
        return None
    side = "long" if m_side.group(1) in ("BUY", "LONG") else "short"
    symbol = m_tick.group(1) or m_tick.group(2)
    entry, target, stop = (float(m_entry.group(1)), float(m_tgt.group(1)),
                           float(m_stop.group(1)))
    coherent = (stop < entry < target) if side == "long" else (target < entry < stop)
    if not coherent:
        return None
    return {"side": side, "symbol": symbol, "entry": entry,
            "stop": stop, "target": target}


# ── inbox + channels (meta kv) ───────────────────────────────────────────────
def _load_list(store: Store, key: str) -> list:
    try:
        v = json.loads(store.get_meta(key) or "[]")
        return v if isinstance(v, list) else []
    except (ValueError, TypeError):
        return []


def channels(store: Store) -> list[str]:
    return _load_list(store, CHANNELS_KEY)


def add_channel(store: Store, name: str) -> list[str]:
    name = (name or "").strip().lstrip("@")
    chans = channels(store)
    if name and name not in chans:
        chans.append(name)
        store.set_meta(CHANNELS_KEY, json.dumps(chans))
    return chans


def remove_channel(store: Store, name: str) -> list[str]:
    chans = [c for c in channels(store) if c != name]
    store.set_meta(CHANNELS_KEY, json.dumps(chans))
    return chans


def inbox(store: Store, limit: int = 50) -> list[dict]:
    return _load_list(store, INBOX_KEY)[-limit:][::-1]   # newest first


def dialogs(store: Store) -> list[dict]:
    """The account's subscribed channels/groups, as last published by the
    listener: [{key, name, at}] where key = '@username' or the numeric id."""
    return _load_list(store, DIALOGS_KEY)


def save_dialogs(store: Store, rows: list[dict]) -> None:
    store.set_meta(DIALOGS_KEY, json.dumps(rows))


def is_allowed(chat_id, username, allow: list[str]) -> bool:
    """Does a message's chat match the allow-list? Entries are usernames
    (stored without '@') or numeric-id strings."""
    ids = {str(a) for a in allow}
    return str(chat_id) in ids or (username or "") in ids


# ── ingest: one message → inbox (+ maybe a paper trade) ─────────────────────
def ingest_message(store: Store, channel: str, msg_id: int, text: str,
                   ts: str | None = None) -> dict:
    """Idempotent per (channel, msg_id). Fully-parsed coherent signals open a
    paper trade (book='telegram', setup=channel); everything else is
    inbox-only with the reason recorded."""
    ts = ts or _dt.datetime.now(_dt.timezone.utc).isoformat()
    items = _load_list(store, INBOX_KEY)
    if any(i.get("channel") == channel and i.get("msg_id") == msg_id for i in items):
        return {"status": "duplicate"}
    sig = parse_signal(text)
    entry = {"channel": channel, "msg_id": msg_id, "ts": ts,
             "text": (text or "")[:400], "parsed": sig, "status": "inbox"}
    if sig is not None:
        # one open trade per (channel, symbol) — a channel re-pumping the same
        # name doesn't pyramid the sim
        dup = any(r.get("symbol") == sig["symbol"] and r.get("setup") == channel
                  for r in store.load_paper_trades(status="open", book=BOOK))
        if dup:
            entry["status"] = "skipped-open"
        else:
            shares = round(NOTIONAL_USD / sig["entry"], 2)
            tid = store.record_paper_trade({
                "book": BOOK, "setup": channel, "source": "telegram",
                "signal": f"tg:{channel}:{msg_id}",   # NOT NULL column; also human-traceable
                "symbol": sig["symbol"], "side": sig["side"],
                "spy_entry": sig["entry"], "spy_target": sig["target"],
                "spy_stop": sig["stop"], "shares": shares,
                "opened_at": ts, "status": "open",
                "opened_price_src": f"telegram @{channel} msg {msg_id}",
            })
            entry["status"] = "traded"
            entry["trade_id"] = tid
    items.append(entry)
    store.set_meta(INBOX_KEY, json.dumps(items[-INBOX_CAP:]))
    return {"status": entry["status"], "trade_id": entry.get("trade_id")}


# ── settlement: first-touch stop/target on the last price ───────────────────
def tick(store: Store, *, price_of=None) -> list[dict]:
    """Close open telegram-book trades whose stop or target the last price has
    reached. Stop-first on ties (the scanner convention). Returns actions."""
    if price_of is None:
        from .scanner_exec import last_price as price_of  # noqa: PLC0415
    now = _dt.datetime.now(_dt.timezone.utc).isoformat()
    actions = []
    for r in store.load_paper_trades(status="open", book=BOOK):
        px = price_of(r["symbol"])
        if px is None:
            continue
        d = 1 if r.get("side") == "long" else -1
        hit_stop = px <= r["spy_stop"] if d > 0 else px >= r["spy_stop"]
        hit_tgt = px >= r["spy_target"] if d > 0 else px <= r["spy_target"]
        if not (hit_stop or hit_tgt):
            continue
        exit_px = r["spy_stop"] if hit_stop else r["spy_target"]   # stop-first
        pnl = round((exit_px - r["spy_entry"]) * d * float(r.get("shares") or 0), 2)
        reason = "stop-loss" if hit_stop else "target"
        store.close_paper_trade(r["id"], spy_exit=round(px, 2), exit_reason=reason,
                                pnl=pnl, pnl_pct=round(
                                    (exit_px / r["spy_entry"] - 1) * d * 100, 2),
                                closed_at=now)
        actions.append({"id": r["id"], "symbol": r["symbol"], "action": reason, "pnl": pnl})
    return actions


# ── the by-channel book (each channel IS a strategy) ─────────────────────────
def build_book(store: Store) -> dict:
    from .paper import paper_stats
    rows = store.load_paper_trades(book=BOOK)
    open_rows = [r for r in rows if r.get("status") == "open"]
    closed = [r for r in rows if r.get("status") == "closed"]
    by_channel = {}
    names = {r.get("setup") or "?" for r in rows}
    for name in sorted(names):
        rows_c = [r for r in closed if (r.get("setup") or "?") == name]
        by_channel[name] = {**paper_stats(rows_c),
                            "open": sum(1 for r in open_rows
                                        if (r.get("setup") or "?") == name)}
    return {"book": BOOK, "open": open_rows,
            "closed": sorted(closed, key=lambda r: r.get("closed_at") or "",
                             reverse=True)[:50],
            "by_channel": by_channel}
