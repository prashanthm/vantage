"""What did I ACTUALLY do today? — reconstructed from the broker's own fills.

The Trading Journal asks "what I did" and expects the operator to type it.
But every fill is already in the store: the Robinhood sync writes each
execution into ``history`` (kind equity|option, side, quantity, price,
amount, state). So the FACTUAL half of a journal entry — what I traded, when,
how much, and what it made — never needs typing. Only the JUDGMENT half
(why, and what I'd do differently) does.

This module reconstructs one session's activity from those fills and pairs
them into round-trips per contract.

WHY NOT reuse ml/roundtrips? That builder keys off Robinhood's
``get_pnl_trade_history`` tool as its authoritative close list. Live
2026-07-14 that tool answered NotFound ("realized gain loss items not
found"), so the ML round-trips silently froze at 2026-07-05 and today's 50
SPXW fills — a real +$2,545 session — never landed anywhere in the product.
Fills are the durable record; realized-P/L is a convenience feed. This reads
the fills.

Pairing: per contract (the display symbol, so 7525C never pairs with 7545P),
walk the fills in time order keeping a signed position; each fill that
REDUCES the position toward zero realizes P&L against the average cost of
the open side. A position still open at the end is reported as such — never
silently closed. Cash flow (``amount``: negative for buys, positive for
sells) is the source of truth for money, so a partially-closed contract still
reports honest realized dollars.

Pure computation over the store — no broker I/O, no orders (ADR-010).
"""
from __future__ import annotations

import datetime as _dt
from collections import defaultdict


def _session_bounds(day: str) -> tuple[str, str]:
    """[start, end) ISO prefixes for one calendar day."""
    return f"{day}T00:00", f"{day}T23:59:59"


def fills_for(store, day: str, underlying: str | None = None) -> list[dict]:
    """Every FILLED execution on ``day``, newest last. ``underlying`` filters
    by symbol prefix (e.g. "SPXW" or "SPX" catches SPXW contracts too)."""
    rows = [r for r in store.load_history()
            if str(r.get("date") or "").startswith(day)
            and str(r.get("state") or "").lower() == "filled"]
    if underlying:
        u = underlying.upper()
        # SPX → SPXW contracts; SPY → SPY. Match the symbol's leading token.
        rows = [r for r in rows
                if str(r.get("symbol") or "").upper().startswith(u)
                or str(r.get("symbol") or "").upper().startswith(u + "W")]
    rows.sort(key=lambda r: str(r.get("date") or ""))
    return rows


def roundtrips(fills: list[dict]) -> list[dict]:
    """Pair fills into per-contract round-trips.

    Returns one row per contract traded: {symbol, kind, fills, bought, sold,
    realized (signed $), still_open (signed contracts), first, last,
    avg_buy, avg_sell}. ``realized`` is cash-flow based, so it is honest even
    when a contract is only partly closed."""
    by_sym: dict[str, list[dict]] = defaultdict(list)
    for f in fills:
        by_sym[str(f.get("symbol") or "?")].append(f)

    out = []
    for sym, rows in by_sym.items():
        bought = sold = 0.0
        buy_notional = sell_notional = 0.0
        cash = 0.0
        for r in rows:
            qty = abs(float(r.get("quantity") or 0))
            price = float(r.get("price") or 0)
            cash += float(r.get("amount") or 0)   # −buys, +sells (already signed)
            if str(r.get("side")) == "buy":
                bought += qty
                buy_notional += qty * price
            else:
                sold += qty
                sell_notional += qty * price
        out.append({
            "symbol": sym,
            "kind": rows[0].get("kind") or "other",
            "fills": len(rows),
            "bought": round(bought, 2),
            "sold": round(sold, 2),
            "avg_buy": round(buy_notional / bought, 2) if bought else None,
            "avg_sell": round(sell_notional / sold, 2) if sold else None,
            "realized": round(cash, 2),
            "still_open": round(bought - sold, 2),   # +long / −short at EOD
            "first": str(rows[0].get("date") or "")[:16],
            "last": str(rows[-1].get("date") or "")[:16],
        })
    out.sort(key=lambda r: abs(r["realized"]), reverse=True)
    return out


def session(store, day: str | None = None,
            underlying: str | None = None) -> dict:
    """One session's ACTUAL trading, reconstructed from broker fills.

    Returns {day, underlying, fills, contracts, realized, winners, losers,
    open_at_close, roundtrips[], summary} — the factual half of a journal
    entry, ready to prefill."""
    day = day or _dt.date.today().isoformat()
    fills = fills_for(store, day, underlying)
    rts = roundtrips(fills)
    realized = round(sum(r["realized"] for r in rts), 2)
    winners = [r for r in rts if r["realized"] > 0]
    losers = [r for r in rts if r["realized"] < 0]
    still_open = [r for r in rts if r["still_open"]]
    return {
        "day": day,
        "underlying": underlying,
        "fills": len(fills),
        "contracts": len(rts),
        "realized": realized,
        "winners": len(winners),
        "losers": len(losers),
        "open_at_close": len(still_open),
        "roundtrips": rts,
        "summary": summarize(day, underlying, fills, rts, realized),
    }


def summarize(day: str, underlying: str | None, fills: list[dict],
              rts: list[dict], realized: float) -> str:
    """The prefill text for the journal's 'what I did' — factual only. The
    operator supplies the judgment (why, and what to change)."""
    if not fills:
        return f"No {underlying or ''} fills on {day}.".strip()
    best = max(rts, key=lambda r: r["realized"])
    worst = min(rts, key=lambda r: r["realized"])
    lines = [
        f"{len(fills)} fills across {len(rts)} contracts"
        + (f" ({underlying})" if underlying else "")
        + f" · realized {realized:+,.2f}",
        f"best: {best['symbol']} {best['realized']:+,.2f}",
    ]
    if worst["realized"] < 0:
        lines.append(f"worst: {worst['symbol']} {worst['realized']:+,.2f}")
    still = [r for r in rts if r["still_open"]]
    if still:
        lines.append("open at close: "
                     + ", ".join(f"{r['symbol']} {r['still_open']:+g}" for r in still))
    return "\n".join(lines)
