"""Turn an ICT scanner hit into a directional DEBIT SPREAD ticket for the paper book.

The user trades scanner setups as debit spreads: bullish → buy a call spread, bearish
→ buy a put spread. The long leg sits at the entry (FVG center, where price is now),
the short leg at the draw/3R runner target (where price is headed) — max profit when
price reaches the target, ~2:1 R:R. The invalidation (buffered, from ict_htf) is the
"thesis wrong, close it" line — NOT a strike.

Size = 4 contracts (the exit ladder scales 50/25/25 → 2/1/1, so size must be ×4).

No live options chain here, so the debit is MODELED (~half the width) purely so R:R is
representable in the track record. Context only (ADR-008) — never an order.
"""
from __future__ import annotations

import datetime as _dt

CONTRACTS = 4          # ×4 so the 50/25/25 ladder is whole (2/1/1)
DEBIT_FRAC = 0.5       # modeled debit ≈ half the spread width (no live chain)
TARGET_DTE = 35        # aim ~35 days out for a swing spread; roll to the 3rd Friday


def _third_friday(year: int, month: int) -> _dt.date:
    """The standard monthly options expiration: the 3rd Friday of the month."""
    d = _dt.date(year, month, 1)
    # weekday(): Mon=0 … Fri=4. First Friday, then +2 weeks.
    first_fri = d + _dt.timedelta(days=(4 - d.weekday()) % 7)
    return first_fri + _dt.timedelta(days=14)


def pick_expiration(today: _dt.date, target_dte: int = TARGET_DTE) -> _dt.date:
    """Nearest monthly (3rd-Friday) expiration on/after today+target_dte. Standard
    listed expiries — Alpaca rejects if the exact contract isn't listed, and the
    submit is best-effort with a sim fallback, so this need only be plausible."""
    aim = today + _dt.timedelta(days=target_dte)
    exp = _third_friday(aim.year, aim.month)
    if exp < aim:                      # this month's already past the aim → next month
        ny, nm = (aim.year + (aim.month // 12), (aim.month % 12) + 1)
        exp = _third_friday(ny, nm)
    return exp


def occ_symbol(underlying: str, expiry: _dt.date, right: str, strike: float) -> str:
    """OCC-21 option symbol: ROOT + YYMMDD + C|P + strike×1000 zero-padded to 8.
    e.g. AMAT, 2026-01-16, C, 540 → 'AMAT260116C00540000'."""
    return (f"{underlying.upper()}{expiry:%y%m%d}{right.upper()}"
            f"{int(round(strike * 1000)):08d}")


def strike_step(price: float) -> float:
    """A plausible standard strike increment for an equity at ``price``.
    Rough listing conventions: $0.50 under $25, $1 under $200, $5 above."""
    p = abs(price)
    if p < 25:
        return 0.5
    if p < 200:
        return 1.0
    return 5.0


def _nearest(price: float, step: float) -> float:
    return round(round(price / step) * step, 2)


def spread_from_hit(hit: dict) -> dict | None:
    """Build the debit-spread ticket dict from a scanner hit, or None if the setup
    can't form a spread (missing fields, or strikes collapse to one increment).

    Returned dict maps onto paper_trades' v24 spread columns + the shared fields
    record_paper_trade expects (signal/side/symbol/spy_entry so legacy code paths
    stay happy)."""
    if not hit or not hit.get("present", True):
        return None
    symbol = hit.get("symbol")
    direction = hit.get("dir")           # 'long' | 'short'
    entry = hit.get("ce")
    targets = hit.get("targets") or []
    invalid = hit.get("invalid")
    as_of = hit.get("as_of")
    if not (symbol and direction and entry and targets and invalid is not None and as_of):
        return None
    runner = targets[-1].get("price")    # the draw / 3R target = short strike ref
    if runner is None:
        return None

    step = strike_step(entry)
    long_strike = _nearest(entry, step)
    short_strike = _nearest(runner, step)
    if long_strike == short_strike:
        return None                      # too tight to form a spread at this increment
    # a debit spread must have long < short for a call (bullish), long > short for a
    # put (bearish); the runner is always on the profit side of entry, so this holds,
    # but guard against a strike-rounding inversion.
    if direction == "long" and not (short_strike > long_strike):
        return None
    if direction == "short" and not (short_strike < long_strike):
        return None

    structure = "debit_call_spread" if direction == "long" else "debit_put_spread"
    width = round(abs(short_strike - long_strike), 2)
    est_debit = round(width * DEBIT_FRAC, 2)
    setup_key = f"{symbol}:{as_of}:{long_strike}:{short_strike}"
    label = (f"{symbol} {'CALL' if direction == 'long' else 'PUT'} debit "
             f"{long_strike}/{short_strike}")
    return {
        # shared paper_trades fields (kept non-null so existing code paths work)
        "signal": label,
        "side": direction,
        "symbol": symbol,
        "spy_entry": entry,              # entry price (generalized; not a SPY proxy)
        "spy_target": short_strike,
        "spy_stop": invalid,
        "shares": CONTRACTS,             # legacy P&L col; spread P&L uses contracts
        # v24 spread columns
        "book": "scanner-spread",
        "structure": structure,
        "underlying": symbol,
        "long_strike": long_strike,
        "short_strike": short_strike,
        "contracts": CONTRACTS,
        "est_debit": est_debit,
        "underlying_entry": round(float(entry), 2),
        "underlying_target": short_strike,
        "underlying_invalid": round(float(invalid), 2),
        "setup_key": setup_key,
        # width isn't a column — kept for callers/self-check
        "width": width,
    }


def alpaca_order(spread: dict, today: _dt.date | None = None) -> dict | None:
    """Build the Alpaca mleg order for a debit spread: buy_to_open the long leg,
    sell_to_open the short leg, both at the picked monthly expiration. Returns the
    internal order shape submit_strategy_order validates (symbol/side/qty/type +
    legs), or None if the spread is missing fields. A debit spread is a net BUY
    (you pay the debit), so order side = buy, type = limit at the modeled debit."""
    if not spread or spread.get("structure") not in ("debit_call_spread", "debit_put_spread"):
        return None
    today = today or _dt.date.today()
    exp = pick_expiration(today)
    right = "C" if spread["structure"] == "debit_call_spread" else "P"
    und = spread["underlying"]
    long_sym = occ_symbol(und, exp, right, spread["long_strike"])
    short_sym = occ_symbol(und, exp, right, spread["short_strike"])
    n = int(spread.get("contracts") or CONTRACTS)
    debit = float(spread.get("est_debit") or 0)
    return {
        "symbol": und,                     # underlying (informational; legs carry the contracts)
        "side": "buy",                     # net debit paid → buy the spread
        "qty": n,
        "type": "limit",
        "limit_price": round(debit, 2) or None,
        "time_in_force": "day",
        "est_usd": round(debit * n * 100, 2),   # debit × contracts × 100
        "expiration": exp.isoformat(),
        "legs": [
            {"symbol": long_sym, "side": "buy", "position_intent": "buy_to_open", "ratio_qty": 1},
            {"symbol": short_sym, "side": "sell", "position_intent": "sell_to_open", "ratio_qty": 1},
        ],
    }


def _demo() -> None:
    """Self-check: long+short strike mapping, structure, dedup key, and the
    too-tight / inverted guards. Offline, no bars."""
    long_hit = {"present": True, "symbol": "AMAT", "dir": "long", "ce": 540.0,
                "invalid": 537.8, "as_of": "2026-07-17T15:30:00-04:00",
                "targets": [{"r": 1, "price": 542}, {"r": 2, "price": 544},
                            {"r": 6.6, "price": 591.09}]}
    s = spread_from_hit(long_hit)
    assert s["structure"] == "debit_call_spread", s
    # AMAT 540 → $5 strike step: long 540, short = nearest($5) of 591.09 = 590
    assert s["long_strike"] == 540.0 and s["short_strike"] == 590.0, s
    assert s["short_strike"] > s["long_strike"], s
    assert s["contracts"] == 4 and s["book"] == "scanner-spread"
    assert s["width"] == 50.0 and s["est_debit"] == 25.0, s
    assert s["setup_key"] == f"AMAT:2026-07-17T15:30:00-04:00:{s['long_strike']}:{s['short_strike']}"

    short_hit = {"present": True, "symbol": "SHOP", "dir": "short", "ce": 124.0,
                 "invalid": 125.2, "as_of": "t",
                 "targets": [{"r": 1, "price": 123}, {"r": 3, "price": 118}]}
    ss = spread_from_hit(short_hit)
    assert ss["structure"] == "debit_put_spread", ss
    assert ss["short_strike"] < ss["long_strike"], ss  # put: short below long

    # too-tight: entry and runner round to the SAME strike → None. At $80 the step
    # is $1, so 82.1 and 82.4 both round to 82 → collapses → no spread.
    tight = {"present": True, "symbol": "KO", "dir": "long", "ce": 82.1,
             "invalid": 81.5, "as_of": "t",
             "targets": [{"r": 1, "price": 82.4}]}
    assert spread_from_hit(tight) is None, "same-strike collapse must return None"

    # missing fields → None
    assert spread_from_hit({"present": True, "symbol": "X"}) is None
    # OCC symbol + expiration + alpaca order
    exp = _dt.date(2026, 1, 16)   # a known 3rd Friday
    assert _third_friday(2026, 1) == exp, _third_friday(2026, 1)
    assert occ_symbol("AMAT", exp, "C", 540) == "AMAT260116C00540000"
    assert occ_symbol("KO", exp, "P", 82.5) == "KO260116P00082500"
    # pick_expiration lands on a 3rd Friday on/after today+35d
    pe = pick_expiration(_dt.date(2026, 1, 1), 35)
    assert pe.weekday() == 4 and pe >= _dt.date(2026, 2, 5), pe
    # alpaca_order: debit call spread → 2 legs, long buy_to_open, short sell_to_open
    o = alpaca_order(s, today=_dt.date(2026, 1, 1))
    assert o["side"] == "buy" and o["type"] == "limit" and o["qty"] == 4, o
    assert len(o["legs"]) == 2, o
    assert o["legs"][0]["position_intent"] == "buy_to_open"   # long leg
    assert o["legs"][1]["position_intent"] == "sell_to_open"  # short leg
    assert o["legs"][0]["symbol"].startswith("AMAT") and "C" in o["legs"][0]["symbol"]
    assert alpaca_order({"structure": "not_a_spread"}) is None

    print("scanner_spread self-check OK")


if __name__ == "__main__":
    _demo()
