"""Reverse DCF — what FCF growth the current price already implies.

Expectations investing turns valuation around: instead of estimating growth to
compute a fair value, solve for the growth rate that makes a standard DCF equal
today's market value. The consumer then compares that implied bar against the
business's actual trajectory (the growth module's ``revenue_yoy``).

Model: two-stage FCF DCF over ``HORIZON_YEARS`` at constant growth ``g``, then
a Gordon terminal value at ``TERMINAL_GROWTH``. With ``x = (1+g)/(1+r)``:

    PV(g) = F0 * [ x(1 - x^N)/(1 - x)  +  x^N (1+gt)/(r - gt) ]

PV is strictly increasing in ``g`` for positive base FCF, so the implied rate
is recovered by bisection — no numeric dependencies. All assumptions are module
constants echoed verbatim into the payload; every result is nullable with an
explicit ``status``, and nothing is ever estimated when an input is missing
(negative FCF makes implied growth mathematically meaningless — the payload
says so instead of guessing).

Pure module: no I/O, no cache. Inputs come from the fundamentals/growth caches
at the call site (the MCP layer), so expectations track price at quote freshness
for free.
"""
from __future__ import annotations

DISCOUNT_RATE = 0.095
TERMINAL_GROWTH = 0.025
HORIZON_YEARS = 10
MODEL = "two_stage_fcf_reverse_dcf"

# Solver bounds: implied growth outside [-90%, +150%] is reported as clamped
# rather than extrapolated.
_G_LO = -0.90
_G_HI = 1.50
_TOL = 1e-6
_SCENARIO_RATES = (0.0, 0.10, 0.20, 0.30)


def present_value(
    fcf: float,
    g: float,
    *,
    discount_rate: float = DISCOUNT_RATE,
    terminal_growth: float = TERMINAL_GROWTH,
    years: int = HORIZON_YEARS,
) -> float:
    """PV of ``years`` of FCF grown at ``g`` plus the Gordon terminal value."""
    r, gt, n = discount_rate, terminal_growth, years
    x = (1.0 + g) / (1.0 + r)
    if abs(x - 1.0) < 1e-12:
        explicit = float(n)
    else:
        explicit = x * (1.0 - x**n) / (1.0 - x)
    terminal = x**n * (1.0 + gt) / (r - gt)
    return fcf * (explicit + terminal)


def implied_growth(
    fcf: float | None,
    value: float | None,
    *,
    discount_rate: float = DISCOUNT_RATE,
    terminal_growth: float = TERMINAL_GROWTH,
    years: int = HORIZON_YEARS,
) -> dict:
    """Solve PV(g) == value for g. Returns ``{fcf_growth_10y, clamped, status}``.

    Statuses: ``ok`` (solved), ``no_fcf``/``no_market_cap`` (missing inputs),
    ``negative_fcf`` (PV not invertible — implied growth undefined). A solution
    outside the bisection bounds returns the bound with ``clamped`` set.
    """
    if value is None or value <= 0:
        return {"fcf_growth_10y": None, "clamped": None, "status": "no_market_cap"}
    if fcf is None:
        return {"fcf_growth_10y": None, "clamped": None, "status": "no_fcf"}
    if fcf <= 0:
        return {"fcf_growth_10y": None, "clamped": None, "status": "negative_fcf"}

    def pv(g: float) -> float:
        return present_value(fcf, g, discount_rate=discount_rate,
                             terminal_growth=terminal_growth, years=years)

    if pv(_G_LO) > value:
        return {"fcf_growth_10y": _G_LO, "clamped": "low", "status": "ok"}
    if pv(_G_HI) < value:
        return {"fcf_growth_10y": _G_HI, "clamped": "high", "status": "ok"}

    lo, hi = _G_LO, _G_HI
    while hi - lo > _TOL:
        mid = (lo + hi) / 2.0
        if pv(mid) < value:
            lo = mid
        else:
            hi = mid
    return {"fcf_growth_10y": round((lo + hi) / 2.0, 6), "clamped": None, "status": "ok"}


def _scenarios(
    fcf: float | None,
    shares: float | None,
    price: float | None,
) -> list[dict]:
    """Fair values at benchmark growth rates — the "what would justify X" table."""
    if fcf is None or fcf <= 0:
        return []
    out = []
    for g in _SCENARIO_RATES:
        fair = present_value(fcf, g)
        per_share = fair / shares if shares else None
        vs_price = (per_share / price - 1.0) * 100.0 if per_share is not None and price else None
        out.append({
            "growth": g,
            "fair_value": round(fair, 0),
            "fair_value_per_share": round(per_share, 2) if per_share is not None else None,
            "vs_price_pct": round(vs_price, 1) if vs_price is not None else None,
        })
    return out


def expectations(
    fundamentals: dict | None,
    growth: dict | None,
    price: float | None,
) -> dict:
    """Assemble the expectations read from cached fundamentals + growth.

    ``value_basis`` records whether the DCF was solved against enterprise value
    (preferred — FCF here approximates FCFF) or market cap (fallback).
    """
    f = fundamentals or {}
    g = growth or {}
    fcf_ttm = g.get("fcf_ttm")
    market_cap = f.get("market_cap")
    enterprise_value = f.get("enterprise_value")
    shares = f.get("shares_outstanding")

    value = enterprise_value if enterprise_value else market_cap
    value_basis = ("enterprise_value" if enterprise_value
                   else "market_cap" if market_cap else None)

    implied = implied_growth(fcf_ttm, value)
    return {
        "symbol": (g.get("symbol") or f.get("symbol")),
        "inputs": {
            "fcf_ttm": fcf_ttm,
            "market_cap": market_cap,
            "enterprise_value": enterprise_value,
            "value_basis": value_basis,
            "price": price,
            "shares_outstanding": shares,
        },
        "assumptions": {
            "discount_rate": DISCOUNT_RATE,
            "terminal_growth": TERMINAL_GROWTH,
            "horizon_years": HORIZON_YEARS,
            "model": MODEL,
        },
        "implied": implied,
        "scenarios": _scenarios(fcf_ttm, shares, price),
    }
