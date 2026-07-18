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
    print("ok — portfolio analyzer self-check passed")


if __name__ == "__main__":
    _demo()
