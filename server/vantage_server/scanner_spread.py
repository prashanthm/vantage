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
#: Marketable cushion above mid for the entry limit. A debit spread is a NET BUY,
#: so a limit AT mid only fills if the market comes to you — it mostly didn't
#: (day limits expired unfilled: breakout_hold filled 17%, all-time 42%). Pay a
#: little toward the natural/ask: limit = mid × (1 + frac), capped at +$0.10/spread
#: so a wide spread doesn't overpay. ponytail: flat cushion; switch to a live
#: bid/ask-derived cross if fills still lag.
ENTRY_CUSHION_FRAC = 0.05   # +5% over mid
ENTRY_CUSHION_CAP = 0.10    # but never more than $0.10 (per 1-lot spread)
TARGET_DTE = 35        # aim ~35 days out for a swing spread; roll to the 3rd Friday
#: max debit risk per CONTRACT (debit × 100). A GATE, not a sizer — the exit
#: ladder needs ×4 contracts, so a spread that costs more than this per
#: contract is recorded as skipped (exit_reason='contract_risk'), never
#: downsized. Pre-gate record: risk ranged $200–$10,000/position; the single
#: AMAT width-50 loss (−$10k) exceeded the whole book's net.
MAX_CONTRACT_RISK = 1000.0


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


def snap_to_chain(symbol: str, direction: str, entry: float, runner: float,
                  as_of: _dt.date) -> dict | None:
    """Snap the spread to LISTED contracts: nearest listed expiry to
    as_of+TARGET_DTE (min 20 DTE — it's a swing spread), nearest listed strikes
    to the entry / runner, and the real mid-price debit from the same chain.
    The strike_step heuristic invents contracts that don't exist (2026-07-23:
    Alpaca 422 'asset not found' on SYK/ABBV; yfinance pricing came back empty
    for the same reason). Returns {expiry, long_strike, short_strike, debit
    (None when quotes are junk)} or None when the chain is unavailable."""
    try:
        import yfinance as yf  # noqa: PLC0415
        t = yf.Ticker(symbol)
        exps = list(t.options or [])
        if not exps:
            return None
        aim = as_of + _dt.timedelta(days=TARGET_DTE)
        cands = [e for e in exps if (_dt.date.fromisoformat(e) - as_of).days >= 20]
        if not cands:
            cands = [e for e in exps if (_dt.date.fromisoformat(e) - as_of).days >= 7]
        if not cands:
            return None
        exp = min(cands, key=lambda e: abs((_dt.date.fromisoformat(e) - aim).days))
        oc = t.option_chain(exp)
        df = oc.calls if direction == "long" else oc.puts
        strikes = sorted({float(s) for s in df["strike"]})
        if len(strikes) < 2:
            return None
        long_k = min(strikes, key=lambda s: abs(s - entry))
        short_k = min(strikes, key=lambda s: abs(s - runner))
        if long_k == short_k:
            # too tight at listed granularity — take the next listed strike out
            i = strikes.index(long_k) + (1 if direction == "long" else -1)
            if not (0 <= i < len(strikes)):
                return None
            short_k = strikes[i]
        if (direction == "long" and short_k <= long_k) or \
           (direction == "short" and short_k >= long_k):
            return None

        def _mid(k: float) -> float | None:
            r = df[df["strike"] == k]
            if r.empty:
                return None
            bid = float(r["bid"].iloc[0] or 0)
            ask = float(r["ask"].iloc[0] or 0)
            if bid > 0 and ask >= bid:
                return (bid + ask) / 2
            last = float(r["lastPrice"].iloc[0] or 0)
            return last or None

        debit = None
        ml, ms = _mid(long_k), _mid(short_k)
        if ml is not None and ms is not None:
            d = round(ml - ms, 2)
            if 0 < d < abs(short_k - long_k):
                debit = d
        return {"expiry": exp, "long_strike": long_k, "short_strike": short_k,
                "debit": debit}
    except Exception:  # noqa: BLE001 — chain trouble must never break the scan
        return None


def chain_debit(symbol: str, expiry: _dt.date, right: str,
                long_strike: float, short_strike: float) -> float | None:
    """REAL debit for the spread from the yfinance option chain (delayed,
    best-effort): mid(long leg) − mid(short leg). None when the chain, the
    strikes, or the quotes are unavailable/nonsense — callers fall back to the
    modeled width×DEBIT_FRAC. Never raises."""
    try:
        import yfinance as yf  # noqa: PLC0415
        oc = yf.Ticker(symbol).option_chain(expiry.isoformat())
        df = oc.calls if right.upper() == "C" else oc.puts

        def _mid(strike: float) -> float | None:
            r = df[df["strike"] == strike]
            if r.empty:
                return None
            bid = float(r["bid"].iloc[0] or 0)
            ask = float(r["ask"].iloc[0] or 0)
            if bid > 0 and ask >= bid:
                return (bid + ask) / 2
            last = float(r["lastPrice"].iloc[0] or 0)
            return last or None

        ml, ms = _mid(long_strike), _mid(short_strike)
        if ml is None or ms is None:
            return None
        debit = round(ml - ms, 2)
        width = abs(short_strike - long_strike)
        # sanity: a debit spread costs more than 0 and less than its width
        return debit if 0 < debit < width else None
    except Exception:  # noqa: BLE001 — junk chain/network must not break the scan
        return None


def spread_from_hit(hit: dict, price_chain: bool = False) -> dict | None:
    """Build the debit-spread ticket dict from a scanner hit, or None if the setup
    can't form a spread (missing fields, or strikes collapse to one increment).

    ``price_chain=True`` prices ``est_debit`` from the real option chain
    (``chain_debit``; network, best-effort) instead of the modeled width×0.5 —
    the modeled 1:1 payoff sits exactly on the break-even knife edge and makes
    the track record uninformative. Default False keeps the builder pure for
    tests/self-checks.

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
    expiration = None
    if price_chain:
        # snap to LISTED contracts (expiry + strikes + real mid debit in one
        # chain read) — heuristic strikes 422 at Alpaca and price as nothing.
        snap = snap_to_chain(symbol, direction, float(entry), float(runner),
                             _dt.date.fromisoformat(str(as_of)[:10]))
        if snap is not None:
            long_strike, short_strike = snap["long_strike"], snap["short_strike"]
            expiration = snap["expiry"]
    width = round(abs(short_strike - long_strike), 2)
    est_debit, debit_src = round(width * DEBIT_FRAC, 2), "modeled"
    if price_chain and expiration is not None:
        snap_debit = snap.get("debit")
        if snap_debit is not None:
            est_debit, debit_src = snap_debit, "chain-mid"
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
        # width/debit_src aren't columns — kept for callers/self-check
        "width": width,
        "debit_src": debit_src,
        # the LISTED expiry the strikes were snapped to (price_chain path) —
        # alpaca_order must use THIS, not re-derive pick_expiration
        "expiration": expiration,
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
    # the snapped LISTED expiry when the ticket carries one (chain-verified
    # contracts); the 3rd-Friday heuristic only as fallback.
    exp = (_dt.date.fromisoformat(spread["expiration"])
           if spread.get("expiration") else pick_expiration(today))
    right = "C" if spread["structure"] == "debit_call_spread" else "P"
    und = spread["underlying"]
    long_sym = occ_symbol(und, exp, right, spread["long_strike"])
    short_sym = occ_symbol(und, exp, right, spread["short_strike"])
    n = int(spread.get("contracts") or CONTRACTS)
    debit = float(spread.get("est_debit") or 0)
    # Cross toward the ask: a limit AT mid rarely fills a multi-leg debit spread.
    # Pay mid + min(5%, $0.10) so real day-limits get hit instead of expiring.
    limit = debit + min(debit * ENTRY_CUSHION_FRAC, ENTRY_CUSHION_CAP) if debit else 0
    return {
        "symbol": und,                     # underlying (informational; legs carry the contracts)
        "side": "buy",                     # net debit paid → buy the spread
        "qty": n,
        "type": "limit",
        "limit_price": round(limit, 2) or None,
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
    # entry limit crosses toward the ask: mid + min(5%, $0.10). AMAT debit=25.0 →
    # 5% would be $1.25, capped at +$0.10 → limit 25.10 (not 25.0).
    assert o["limit_price"] == 25.10, o["limit_price"]
    # a cheap spread stays on the 5% branch: debit 0.40 → +$0.02 → 0.42
    cheap = dict(s, est_debit=0.40)
    assert alpaca_order(cheap, today=_dt.date(2026, 1, 1))["limit_price"] == 0.42
    assert alpaca_order({"structure": "not_a_spread"}) is None

    print("scanner_spread self-check OK")


if __name__ == "__main__":
    _demo()
