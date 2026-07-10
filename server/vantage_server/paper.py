"""Paper-trading tracker for the 0DTE playbook — a NO-MONEY track record.

The playbook reads SPX; retail trades the SPY proxy. This module translates the
playbook's SPX levels into SPY (via the live SPX/SPY ratio), builds trade TICKETS
(here's the entry, target, stop, and share size for each signal), and — when you
log one — opens a simulated SPY-shares trade. Open trades AUTO-CLOSE by scanning
SPY intraday bars for the first touch of the target or the stop, so the track
record reflects real price action even between checks.

Why this exists: the futures analysis showed the mean-revert playbook can
underperform on a trend day (R:R ~1.1). Before risking real money on this
narrative, a paper record tells you honestly whether trading the levels works.

This is a SIMULATION. It places NO real orders and touches no broker or funds
(ADR-010). P&L is tracked on SPY shares (the simplest honest proxy); the nearest
0DTE strike is shown for reference only. Not financial advice.

CLI: ``python -m vantage_server.paper [--tickets | --settle] [--data-dir D]``.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import sys
from zoneinfo import ZoneInfo

from .store import Store, resolve_data_dir

EXIT_OK = 0
EXIT_USER_ERROR = 2
ET = ZoneInfo("America/New_York")

STOP_PAD_PCT = 0.20   # stop sits this % beyond the signal level (SPX terms)
DEFAULT_SHARES = 100  # notional share size for the paper P&L


# ── SPX → SPY translation ────────────────────────────────────────────────────

def _fetch_spy_15m():
    from . import spx_playbook as sp
    return sp._fetch_15m("SPY")


def spy_price_and_ratio(spx_spot: float | None):
    """Live SPY price (latest 15m close) and the SPX/SPY ratio. Returns
    ``(spy_price, ratio, bars)`` — bars kept for settlement. ratio ~10."""
    df = _fetch_spy_15m()
    if df is None or getattr(df, "empty", True):
        return None, None, df
    spy = float(df["Close"].iloc[-1])
    ratio = (spx_spot / spy) if (spx_spot and spy) else 10.0
    return spy, ratio, df


def to_spy(spx_level: float, ratio: float) -> float:
    return round(spx_level / ratio, 2)


def nearest_strike(spy_price: float, step: float = 1.0) -> float:
    """Nearest listed SPY 0DTE strike (SPY strikes are $1 wide near ATM)."""
    return round(round(spy_price / step) * step, 2)


# ── ticket generation from the playbook scaffold ─────────────────────────────

def build_tickets(scaffold: dict, spy_price: float, ratio: float) -> list[dict]:
    """Turn the playbook's confluence zones into SPY trade tickets. A SUPPORT
    zone below spot → a 'buy dip' (long); a RESISTANCE zone above → a 'fade
    rally' (short). Target = the next opposing playbook level; stop = just beyond
    the signal level. Only zones within a tradeable distance of spot are shown."""
    spx_spot = (scaffold.get("regime") or {}).get("spot")
    conf = scaffold.get("confluence") or []
    if not conf or spx_spot is None:
        return []
    # SPX levels sorted for target-picking
    supports = sorted([z for z in conf if z["role"] == "support"], key=lambda z: -z["price"])
    resistances = sorted([z for z in conf if z["role"] == "resistance"], key=lambda z: z["price"])
    tickets: list[dict] = []

    def _mk(zone, side):
        lvl = zone["price"]
        # ENTRY is the signal LEVEL (you buy the dip AT support / fade the rally AT
        # resistance) — a resting order, not a market order at spot. Target = the
        # next opposing level; stop = just past the signal level.
        if side == "long":       # buy dip at support → target next resistance up
            tgt = next((r["price"] for r in resistances if r["price"] > lvl), None)
            stop = lvl * (1 - STOP_PAD_PCT / 100)
        else:                    # fade rally at resistance → target next support down
            tgt = next((s["price"] for s in supports if s["price"] < lvl), None)
            stop = lvl * (1 + STOP_PAD_PCT / 100)
        entry_spy = to_spy(lvl, ratio)   # enter AT the level (resting limit order)
        tgt_spy = to_spy(tgt, ratio) if tgt is not None else None
        stop_spy = to_spy(stop, ratio)
        # risk:reward in SPY terms (for display)
        risk = abs(entry_spy - stop_spy)
        reward = abs(tgt_spy - entry_spy) if tgt_spy is not None else None
        rr = round(reward / risk, 2) if (reward and risk) else None
        return {
            "signal": ("buy the dip near " if side == "long" else "fade the rally near ")
                      + f"{to_spy(lvl, ratio):.2f}",
            "side": side,
            "symbol": "SPY",
            "spx_level": round(lvl, 1),
            "spy_level": to_spy(lvl, ratio),
            "spy_entry": round(entry_spy, 2),
            "spy_now": round(spy_price, 2),   # current price, for "distance to entry"
            "spy_target": tgt_spy,
            "spy_stop": round(stop_spy, 2),
            "shares": DEFAULT_SHARES,
            "ref_strike": nearest_strike(entry_spy),
            "reward_risk": rr,
            "kinds": zone.get("kinds", []),
        }

    # nearest support below + nearest resistance above spot are the actionable ones
    below = [z for z in supports if z["price"] < spx_spot][:2]
    above = [z for z in resistances if z["price"] > spx_spot][:2]
    for z in below:
        tickets.append(_mk(z, "long"))
    for z in above:
        tickets.append(_mk(z, "short"))
    return tickets


# ── open + settle ────────────────────────────────────────────────────────────

def open_paper_trade(store: Store, ticket: dict, *, session: str | None = None,
                     source: str = "manual", now: _dt.datetime | None = None) -> int:
    """Log a paper trade from a ticket at its entry price."""
    now = now or _dt.datetime.now(ET)
    return store.record_paper_trade({
        "opened_at": now.isoformat(),
        "session": session,
        "signal": ticket["signal"],
        "side": ticket["side"],
        "symbol": "SPY",
        "spx_level": ticket.get("spx_level"),
        "spy_entry": ticket["spy_entry"],
        "spy_target": ticket.get("spy_target"),
        "spy_stop": ticket.get("spy_stop"),
        "shares": ticket.get("shares", DEFAULT_SHARES),
        "ref_strike": ticket.get("ref_strike"),
        "source": source,
        "status": "open",
        "opened_price_src": "SPY 15m close",
    })


def _settle_one(trade: dict, bars) -> dict | None:
    """Scan SPY 15m bars AFTER the trade opened for the first touch of target or
    stop. Returns ``{spy_exit, exit_reason, pnl, pnl_pct, closed_at}`` or None if
    neither was hit yet (trade stays open). Target-or-stop, whichever bar first."""
    opened = trade.get("opened_at") or ""
    side = trade["side"]
    entry = float(trade["spy_entry"])
    tgt = trade.get("spy_target")
    stop = trade.get("spy_stop")
    shares = float(trade.get("shares") or DEFAULT_SHARES)
    # only bars strictly after the open timestamp
    try:
        import pandas as pd  # noqa: F401
    except Exception:  # noqa: BLE001
        return None
    for ts, row in bars.iterrows():
        bar_iso = ts.to_pydatetime().isoformat()
        if bar_iso <= opened:
            continue
        hi, lo = float(row["High"]), float(row["Low"])
        hit_reason = None; exit_px = None
        if side == "long":
            # long: stop below entry, target above
            if stop is not None and lo <= stop:
                hit_reason, exit_px = "stop", stop
            elif tgt is not None and hi >= tgt:
                hit_reason, exit_px = "target", tgt
        else:  # short
            if stop is not None and hi >= stop:
                hit_reason, exit_px = "stop", stop
            elif tgt is not None and lo <= tgt:
                hit_reason, exit_px = "target", tgt
        if hit_reason:
            direction = 1 if side == "long" else -1
            pnl = round((exit_px - entry) * direction * shares, 2)
            pnl_pct = round((exit_px - entry) / entry * 100 * direction, 3)
            return {"spy_exit": round(exit_px, 2), "exit_reason": hit_reason,
                    "pnl": pnl, "pnl_pct": pnl_pct, "closed_at": bar_iso}
    return None


def settle_open(store: Store) -> dict:
    """Check every OPEN paper trade against fresh SPY bars; close the ones that
    hit target or stop. Returns ``{checked, closed}``."""
    open_trades = store.load_paper_trades("open")
    if not open_trades:
        return {"checked": 0, "closed": 0}
    df = _fetch_spy_15m()
    if df is None or getattr(df, "empty", True):
        return {"checked": len(open_trades), "closed": 0}
    closed = 0
    for t in open_trades:
        res = _settle_one(t, df)
        if res and store.close_paper_trade(
                t["id"], spy_exit=res["spy_exit"], exit_reason=res["exit_reason"],
                pnl=res["pnl"], pnl_pct=res["pnl_pct"], closed_at=res["closed_at"]):
            closed += 1
    return {"checked": len(open_trades), "closed": closed}


def close_manually(store: Store, trade_id: int, spy_exit: float,
                   now: _dt.datetime | None = None) -> bool:
    """Close an open paper trade at a given SPY price (user pressed 'close')."""
    now = now or _dt.datetime.now(ET)
    t = next((x for x in store.load_paper_trades("open") if x["id"] == trade_id), None)
    if not t:
        return False
    direction = 1 if t["side"] == "long" else -1
    entry = float(t["spy_entry"]); shares = float(t.get("shares") or DEFAULT_SHARES)
    pnl = round((spy_exit - entry) * direction * shares, 2)
    pnl_pct = round((spy_exit - entry) / entry * 100 * direction, 3)
    return store.close_paper_trade(trade_id, spy_exit=round(spy_exit, 2),
                                   exit_reason="manual", pnl=pnl, pnl_pct=pnl_pct,
                                   closed_at=now.isoformat())


# ── stats over the closed record ─────────────────────────────────────────────

def paper_stats(closed: list[dict]) -> dict:
    n = len(closed)
    if not n:
        return {"n": 0}
    wins = [t for t in closed if (t.get("pnl") or 0) > 0]
    losses = [t for t in closed if (t.get("pnl") or 0) <= 0]
    total = sum(t.get("pnl") or 0 for t in closed)
    gw = sum(t.get("pnl") or 0 for t in wins)
    gl = sum(t.get("pnl") or 0 for t in losses)
    by_reason = {}
    for t in closed:
        by_reason[t.get("exit_reason")] = by_reason.get(t.get("exit_reason"), 0) + 1
    return {
        "n": n, "wins": len(wins), "losses": len(losses),
        "win_rate": round(len(wins) / n, 4),
        "total_pnl": round(total, 2),
        "avg_win": round(gw / len(wins), 2) if wins else None,
        "avg_loss": round(gl / len(losses), 2) if losses else None,
        "profit_factor": round(gw / abs(gl), 2) if gl else None,
        "by_exit": by_reason,
    }


def equity_curve(closed: list[dict]) -> list[dict]:
    ordered = sorted(closed, key=lambda t: (t.get("closed_at") or "",))
    out, cum, peak = [], 0.0, 0.0
    for i, t in enumerate(ordered):
        cum += (t.get("pnl") or 0.0)
        peak = max(peak, cum)
        out.append({"i": i, "closed_at": t.get("closed_at"),
                    "pnl": round(t.get("pnl") or 0, 2), "cum": round(cum, 2),
                    "peak": round(peak, 2)})
    return out


def build_analysis(store: Store, scaffold: dict | None = None) -> dict:
    """The full paper-trading view: today's tickets (if a scaffold is given),
    open positions, closed track record + stats. Read-path for the API + CLI."""
    tickets = []
    if scaffold:
        spx_spot = (scaffold.get("regime") or {}).get("spot")
        spy, ratio, _ = spy_price_and_ratio(spx_spot)
        if spy:
            tickets = build_tickets(scaffold, spy, ratio)
    open_trades = store.load_paper_trades("open")
    closed = store.load_paper_trades("closed")
    return {
        "tickets": tickets,
        "open": open_trades,
        "closed": closed,
        "stats": paper_stats(closed),
        "equity_curve": equity_curve(closed),
        "note": ("Paper trades on SPY as an SPX proxy — no real money, no orders. "
                 "P&L is on SPY shares; the 0DTE strike is reference only."),
    }


# ============================================================ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.paper",
        description="Paper-trade the 0DTE playbook on SPY (no money, no orders). "
                    "Build tickets, or settle open trades against SPY bars.")
    p.add_argument("--data-dir", help="override the data directory")
    p.add_argument("--tickets", action="store_true", help="print today's SPY trade tickets")
    p.add_argument("--settle", action="store_true", help="auto-close open trades that hit target/stop")
    return p


def _run(args: argparse.Namespace) -> int:
    store = Store(resolve_data_dir(args.data_dir))
    if not getattr(store, "uses_sqlite", False):
        print("error: paper trading requires the SQLite backend", file=sys.stderr)
        return EXIT_USER_ERROR
    if args.settle:
        res = settle_open(store)
        print(f"paper: checked {res['checked']} open, closed {res['closed']}")
    if args.tickets or not args.settle:
        row = store.load_spx_playbook()
        scaffold = (row or {}).get("scaffold") if row else None
        view = build_analysis(store, scaffold)
        for t in view["tickets"]:
            print(f"  [{t['side']:>5}] {t['signal']} | entry {t['spy_entry']} "
                  f"target {t['spy_target']} stop {t['spy_stop']} "
                  f"(R:R {t['reward_risk']}, ~{t['ref_strike']} strike)")
        s = view["stats"]
        if s.get("n"):
            print(f"  record: {s['n']} closed, {round(100*s['win_rate'])}% win, "
                  f"net ${s['total_pnl']:,.0f} (PF {s['profit_factor']})")
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    return _run(_build_parser().parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
