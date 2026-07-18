"""Portfolio-analyzer compute — pure functions over the already-computed position
book + per-ticker fundamentals. No I/O (the caller passes positions + a fundamentals
lookup); no clock, no network. Mirrors engine.py's style.

The analyzer answers the questions a per-ticker notebook can't: how diversified am I,
what income do I throw off, how concentrated, what's my portfolio beta, and how far
have I drifted from a target allocation. Returns/equity-curve live elsewhere (they
need a value-history time series); everything here is point-in-time from holdings.
"""
from __future__ import annotations

from typing import Any, Callable, Sequence


def _held(positions: Sequence[Any]) -> list[Any]:
    """Real equity/cash holdings with a positive value (skip zero/sleeve rows)."""
    out = []
    for p in positions:
        v = _num(getattr(p, "value", None) if not isinstance(p, dict) else p.get("value"))
        if v and v > 0:
            out.append(p)
    return out


def _get(p: Any, key: str, default=None):
    return p.get(key, default) if isinstance(p, dict) else getattr(p, key, default)


def _num(v) -> float | None:
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


def diversification(positions: Sequence[Any], fund_of: Callable[[str], dict | None]) -> dict:
    """Sector + single-name weights and concentration metrics. `fund_of(sym)` returns
    the ticker's fundamentals ({sector, ...}) or None. Weights are % of total value."""
    held = _held(positions)
    total = sum(_num(_get(p, "value")) or 0.0 for p in held)
    if total <= 0:
        return {"total": 0.0, "by_sector": {}, "top_holdings": [], "concentration": {}}

    by_sector: dict[str, float] = {}
    names: list[tuple[str, float]] = []
    for p in held:
        sym = str(_get(p, "symbol") or "")
        v = _num(_get(p, "value")) or 0.0
        w = v / total * 100.0
        if sym.upper() == "CASH":
            sector = "Cash"
        else:
            f = fund_of(sym) or {}
            sector = (f.get("sector") if isinstance(f, dict) else None) or "Unknown"
        by_sector[sector] = by_sector.get(sector, 0.0) + w
        names.append((sym, w))

    names.sort(key=lambda x: x[1], reverse=True)
    top5 = sum(w for _, w in names[:5])
    top_name = names[0] if names else ("", 0.0)
    top_sector = max(by_sector.items(), key=lambda kv: kv[1]) if by_sector else ("", 0.0)
    # Herfindahl-Hirschman Index over holding weights (fractions) → 0..1.
    hhi = sum((w / 100.0) ** 2 for _, w in names)
    band = ("concentrated" if hhi >= 0.25 else "moderate" if hhi >= 0.15 else "diversified")

    return {
        "total": round(total, 2),
        "by_sector": {k: round(v, 2) for k, v in sorted(by_sector.items(), key=lambda kv: -kv[1])},
        "top_holdings": [{"symbol": s, "weight": round(w, 2)} for s, w in names[:10]],
        "concentration": {
            "hhi": round(hhi, 4), "band": band,
            "top5_weight": round(top5, 2),
            "top_name": {"symbol": top_name[0], "weight": round(top_name[1], 2)},
            "top_sector": {"sector": top_sector[0], "weight": round(top_sector[1], 2)},
            # single-name flags at the same >7% the UI already uses.
            "single_name_flags": [{"symbol": s, "weight": round(w, 2)}
                                  for s, w in names if w > 7.0],
        },
    }


def income(positions: Sequence[Any], fund_of: Callable[[str], dict | None]) -> dict:
    """Projected annual dividend income, portfolio yield, yield-on-cost, and the
    per-holding contribution list. `dividend_yield` from yfinance is a PERCENT number
    (2.18 = 2.18%), so income = value × yield/100."""
    held = _held(positions)
    total_val = sum(_num(_get(p, "value")) or 0.0 for p in held)
    total_cost = sum(_num(_get(p, "cost")) or 0.0 for p in held)
    rows = []
    annual = 0.0
    for p in held:
        sym = str(_get(p, "symbol") or "")
        if sym.upper() == "CASH":
            continue
        v = _num(_get(p, "value")) or 0.0
        f = fund_of(sym) or {}
        y = _num(f.get("dividend_yield")) if isinstance(f, dict) else None
        if not y or y <= 0:
            continue
        inc = v * (y / 100.0)   # value already reflects shares × price; y is a percent
        annual += inc
        rows.append({"symbol": sym, "yield": round(y, 2), "annual_income": round(inc, 2)})
    rows.sort(key=lambda r: r["annual_income"], reverse=True)
    return {
        "annual_income": round(annual, 2),
        "portfolio_yield": round(annual / total_val * 100, 2) if total_val else 0.0,
        "yield_on_cost": round(annual / total_cost * 100, 2) if total_cost else 0.0,
        "contributors": rows,
    }


def character(positions: Sequence[Any], fund_of: Callable[[str], dict | None]) -> dict:
    """Weighted-average portfolio beta + blended P/E (value-weighted over holdings
    that have the metric; weights renormalized to those with data)."""
    held = [p for p in _held(positions) if str(_get(p, "symbol") or "").upper() != "CASH"]
    total = sum(_num(_get(p, "value")) or 0.0 for p in held)
    if total <= 0:
        return {"beta": None, "pe": None}

    def _wavg(field: str) -> float | None:
        num = den = 0.0
        for p in held:
            v = _num(_get(p, "value")) or 0.0
            f = fund_of(str(_get(p, "symbol") or "")) or {}
            m = _num(f.get(field)) if isinstance(f, dict) else None
            if m is not None and m == m:
                num += v * m
                den += v
        return round(num / den, 2) if den > 0 else None

    return {"beta": _wavg("beta"), "pe": _wavg("pe"),
            "covered_pct": round(sum(
                _num(_get(p, "value")) or 0.0 for p in held
                if isinstance(fund_of(str(_get(p, "symbol") or "")) or {}, dict)
                and _num((fund_of(str(_get(p, "symbol") or "")) or {}).get("beta")) is not None
            ) / total * 100, 1) if total else 0.0}


def realized_gains(history: Sequence[dict], year: int | None = None,
                   st_rate: float = 0.0, lt_rate: float = 0.0) -> dict:
    """Realized capital gains from imported EQUITY history via FIFO lot-matching.
    Each sell consumes the oldest buy lots of that symbol; gain = proceeds - matched
    cost; a matched lot held >365 days is long-term. Sells whose symbol has no prior
    buy in the history (bought before the import window) go to a `cost_unknown` bucket
    with proceeds only. `st_rate`/`lt_rate` are decimals (0.24 = 24%) for an estimate.
    Filter to `year` (by sell date) when given. Options are excluded (trading side)."""
    import datetime as _dt

    def _d(s):  # parse an ISO date (date or datetime) to a date, or None
        try:
            return _dt.date.fromisoformat(str(s)[:10])
        except (TypeError, ValueError):
            return None

    # per-symbol FIFO queues of buy lots: [remaining_shares, cost_per_share, buy_date]
    buys: dict[str, list[list]] = {}
    # process chronologically so FIFO is correct
    eq = [r for r in history if str(r.get("kind", "")).lower() == "equity"]
    eq.sort(key=lambda r: str(r.get("date") or ""))
    st_gain = lt_gain = unknown_proceeds = 0.0
    st_lots: list[dict] = []
    lt_lots: list[dict] = []
    unknown: list[dict] = []

    for r in eq:
        sym = str(r.get("symbol") or "").upper()
        side = str(r.get("side") or "").lower()
        qty = _num(r.get("quantity")) or 0.0
        price = _num(r.get("price")) or 0.0
        d = _d(r.get("date"))
        if side == "buy" and qty > 0:
            buys.setdefault(sym, []).append([qty, price, d])
        elif side == "sell" and qty > 0:
            if year is not None and (d is None or d.year != year):
                # still consume lots so later same-year sells match correctly,
                # but don't count this sell's gain toward the requested year.
                _consume(buys.get(sym, []), qty)
                continue
            remaining = qty
            q = buys.get(sym, [])
            while remaining > 1e-9 and q:
                lot = q[0]
                take = min(remaining, lot[0])
                cost = take * lot[1]
                proceeds = take * price
                gain = proceeds - cost
                held_days = (d - lot[2]).days if (d and lot[2]) else None
                is_lt = held_days is not None and held_days > 365
                rec = {"symbol": sym, "date": str(r.get("date"))[:10], "shares": round(take, 4),
                       "proceeds": round(proceeds, 2), "cost": round(cost, 2),
                       "gain": round(gain, 2), "held_days": held_days,
                       "term": "long" if is_lt else "short"}
                if is_lt:
                    lt_gain += gain; lt_lots.append(rec)
                else:
                    st_gain += gain; st_lots.append(rec)
                lot[0] -= take
                remaining -= take
                if lot[0] <= 1e-9:
                    q.pop(0)
            if remaining > 1e-9:  # no matching buy lots left → cost basis unknown
                p = remaining * price
                unknown_proceeds += p
                unknown.append({"symbol": sym, "date": str(r.get("date"))[:10],
                                "shares": round(remaining, 4), "proceeds": round(p, 2)})

    total = st_gain + lt_gain
    est_tax = st_gain * st_rate * (st_gain > 0) + lt_gain * lt_rate * (lt_gain > 0)
    return {
        "year": year, "total_gain": round(total, 2),
        "short_term": {"gain": round(st_gain, 2), "n": len(st_lots)},
        "long_term": {"gain": round(lt_gain, 2), "n": len(lt_lots)},
        "estimated_tax": round(est_tax, 2),
        "cost_unknown": {"proceeds": round(unknown_proceeds, 2), "rows": unknown},
        "lots": sorted(st_lots + lt_lots, key=lambda x: x["date"], reverse=True),
    }


def _consume(q: list[list], qty: float) -> None:
    """FIFO-consume `qty` shares from a buy-lot queue in place (used for out-of-year
    sells so later same-year matching stays correct)."""
    remaining = qty
    while remaining > 1e-9 and q:
        lot = q[0]
        take = min(remaining, lot[0])
        lot[0] -= take
        remaining -= take
        if lot[0] <= 1e-9:
            q.pop(0)


def rebalance(alloc_by_class: dict[str, dict], targets: dict[str, float], total: float) -> dict:
    """Drift vs target per asset class + cash-neutral trade suggestions to close the
    largest drifts. `alloc_by_class` = {cls: {value, pct}}; `targets` = {cls: pct}."""
    rows = []
    for cls, tgt in targets.items():
        cur = (alloc_by_class.get(cls) or {}).get("pct", 0.0)
        drift = round(cur - tgt, 2)
        dollars = round((drift / 100.0) * total, 2) if total else 0.0  # + = overweight
        rows.append({"asset_class": cls, "current_pct": round(cur, 2), "target_pct": tgt,
                     "drift_pct": drift, "trade_usd": -dollars,   # trade to correct: sell if over
                     "action": "trim" if dollars > 0 else "add" if dollars < 0 else "hold"})
    rows.sort(key=lambda r: abs(r["drift_pct"]), reverse=True)
    max_drift = max((abs(r["drift_pct"]) for r in rows), default=0.0)
    return {"rows": rows, "max_drift_pct": round(max_drift, 2),
            "in_band": max_drift < 3.0}   # 3% band, same as the existing UI nudge


def _demo() -> None:
    """assert-based self-check for the analyzer math (run: python -m vantage_server.portfolio)."""
    class P:
        def __init__(self, symbol, value, cost=0.0):
            self.symbol, self.value, self.cost = symbol, value, cost
    pos = [P("AAPL", 6000, 4000), P("MSFT", 3000, 2000), P("CASH", 1000, 1000)]
    # dividend_yield is a PERCENT number (0.5 = 0.5%), matching yfinance.
    fund = {"AAPL": {"sector": "Tech", "beta": 1.2, "dividend_yield": 0.5, "pe": 30},
            "MSFT": {"sector": "Tech", "beta": 0.9, "dividend_yield": 0.8, "pe": 35}}
    d = diversification(pos, lambda s: fund.get(s))
    assert abs(d["by_sector"]["Tech"] - 90.0) < 0.01, d["by_sector"]      # 9000/10000
    assert abs(d["by_sector"]["Cash"] - 10.0) < 0.01
    assert d["concentration"]["top_name"]["symbol"] == "AAPL"
    assert d["concentration"]["hhi"] > 0.15   # concentrated 2-name book
    inc = income(pos, lambda s: fund.get(s))
    # AAPL 6000*.005=30, MSFT 3000*.008=24 → 54; yield 54/10000=0.54%
    assert abs(inc["annual_income"] - 54.0) < 0.01, inc
    assert abs(inc["portfolio_yield"] - 0.54) < 0.01
    ch = character(pos, lambda s: fund.get(s))
    # beta over AAPL+MSFT (9000): (6000*1.2 + 3000*0.9)/9000 = 1.1
    assert abs(ch["beta"] - 1.1) < 0.01, ch
    rb = rebalance({"usEquity": {"pct": 90}, "cash": {"pct": 10}},
                   {"usEquity": 70, "cash": 5}, 10000)
    over = next(r for r in rb["rows"] if r["asset_class"] == "usEquity")
    assert over["drift_pct"] == 20.0 and over["trade_usd"] == -2000.0, over   # trim $2000
    assert not rb["in_band"]

    # realized gains — FIFO + ST/LT split + unmatched sell
    hist = [
        {"kind": "equity", "symbol": "X", "side": "buy",  "date": "2024-01-10", "quantity": 10, "price": 100},
        {"kind": "equity", "symbol": "X", "side": "buy",  "date": "2026-06-01", "quantity": 10, "price": 120},
        # sell 15 @ 130 on 2026-07-01: 10 from the 2024 lot (LT, held ~2.5y, gain 10*30=300),
        # 5 from the 2026 lot (ST, held ~1mo, gain 5*10=50)
        {"kind": "equity", "symbol": "X", "side": "sell", "date": "2026-07-01", "quantity": 15, "price": 130},
        # a sell with no prior buy → cost unknown, proceeds only
        {"kind": "equity", "symbol": "Y", "side": "sell", "date": "2026-07-02", "quantity": 4, "price": 50},
        {"kind": "option", "symbol": "SPXW C", "side": "sell", "date": "2026-07-02", "quantity": 1, "price": 5},  # excluded
    ]
    rg = realized_gains(hist, year=2026, st_rate=0.24, lt_rate=0.15)
    assert rg["long_term"]["gain"] == 300.0, rg["long_term"]
    assert rg["short_term"]["gain"] == 50.0, rg["short_term"]
    assert rg["total_gain"] == 350.0
    assert rg["cost_unknown"]["proceeds"] == 200.0, rg["cost_unknown"]   # 4*50
    # tax: 300*.15 + 50*.24 = 45 + 12 = 57
    assert rg["estimated_tax"] == 57.0, rg["estimated_tax"]
    print("ok — portfolio analyzer self-check passed")


if __name__ == "__main__":
    _demo()
