"""Reverse DCF: solver correctness, monotonicity, statuses, scenario table.

Pure module — no I/O anywhere in these tests.
"""
from __future__ import annotations

from vantage_server.expectations import (
    DISCOUNT_RATE,
    HORIZON_YEARS,
    TERMINAL_GROWTH,
    expectations,
    implied_growth,
    present_value,
)


# ------------------------------------------------------------ solver

def test_solver_recovers_known_growth_rate():
    # Build a value from a known g; the solver must recover it.
    for g in (-0.20, 0.0, 0.12, 0.35, 0.80):
        value = present_value(100.0, g)
        out = implied_growth(100.0, value)
        assert out["status"] == "ok"
        assert out["clamped"] is None
        assert abs(out["fcf_growth_10y"] - g) < 1e-4


def test_pv_monotonic_in_growth():
    pvs = [present_value(100.0, g) for g in (-0.5, -0.1, 0.0, 0.1, 0.3, 0.9)]
    assert pvs == sorted(pvs)


def test_pv_handles_growth_equal_to_discount_rate():
    # x == 1 branch: g == r makes each explicit-stage year worth exactly F0.
    pv = present_value(100.0, DISCOUNT_RATE)
    explicit = 100.0 * HORIZON_YEARS
    terminal = 100.0 * (1 + TERMINAL_GROWTH) / (DISCOUNT_RATE - TERMINAL_GROWTH)
    assert abs(pv - (explicit + terminal)) < 1e-6


# ------------------------------------------------------------ statuses

def test_negative_fcf_is_undefined_not_estimated():
    out = implied_growth(-50.0, 10_000.0)
    assert out == {"fcf_growth_10y": None, "clamped": None, "status": "negative_fcf"}


def test_missing_inputs_have_explicit_statuses():
    assert implied_growth(None, 10_000.0)["status"] == "no_fcf"
    assert implied_growth(100.0, None)["status"] == "no_market_cap"
    assert implied_growth(100.0, 0.0)["status"] == "no_market_cap"


def test_extreme_values_clamp_not_extrapolate():
    tiny = present_value(100.0, -0.90) / 2
    huge = present_value(100.0, 1.50) * 2
    lo = implied_growth(100.0, tiny)
    hi = implied_growth(100.0, huge)
    assert lo["clamped"] == "low" and lo["fcf_growth_10y"] == -0.90
    assert hi["clamped"] == "high" and hi["fcf_growth_10y"] == 1.50


# ------------------------------------------------------------ assembler

def _fund(**over):
    base = {"symbol": "ACME", "market_cap": 50_000.0,
            "enterprise_value": 52_000.0, "shares_outstanding": 1_000.0}
    base.update(over)
    return base


def _growth(**over):
    base = {"symbol": "ACME", "fcf_ttm": 2_000.0}
    base.update(over)
    return base


def test_expectations_prefers_enterprise_value_and_records_basis():
    out = expectations(_fund(), _growth(), price=50.0)
    assert out["inputs"]["value_basis"] == "enterprise_value"
    assert out["implied"]["status"] == "ok"
    # implied must invert PV against EV, not market cap
    recovered = present_value(2_000.0, out["implied"]["fcf_growth_10y"])
    assert abs(recovered - 52_000.0) < 1.0


def test_expectations_falls_back_to_market_cap():
    out = expectations(_fund(enterprise_value=None), _growth(), price=50.0)
    assert out["inputs"]["value_basis"] == "market_cap"
    assert out["implied"]["status"] == "ok"


def test_expectations_assumptions_echoed_verbatim():
    out = expectations(_fund(), _growth(), price=50.0)
    assert out["assumptions"] == {
        "discount_rate": DISCOUNT_RATE,
        "terminal_growth": TERMINAL_GROWTH,
        "horizon_years": HORIZON_YEARS,
        "model": "two_stage_fcf_reverse_dcf",
    }


def test_scenario_table_per_share_vs_price():
    out = expectations(_fund(), _growth(), price=50.0)
    rows = out["scenarios"]
    assert [r["growth"] for r in rows] == [0.0, 0.10, 0.20, 0.30]
    for r in rows:
        # per-share derives from the unrounded fair value; allow rounding slack
        assert abs(r["fair_value_per_share"] - r["fair_value"] / 1_000.0) < 0.01
        assert r["vs_price_pct"] is not None
    # fair value rises with assumed growth
    assert [r["fair_value"] for r in rows] == sorted(r["fair_value"] for r in rows)


def test_etf_shape_degrades_to_nulls():
    out = expectations({"symbol": "VOO", "market_cap": None,
                        "enterprise_value": None, "shares_outstanding": None},
                       None, price=520.0)
    assert out["implied"]["status"] in ("no_market_cap", "no_fcf")
    assert out["implied"]["fcf_growth_10y"] is None
    assert out["scenarios"] == []


def test_negative_fcf_keeps_inputs_visible():
    out = expectations(_fund(), _growth(fcf_ttm=-500.0), price=50.0)
    assert out["implied"]["status"] == "negative_fcf"
    assert out["inputs"]["fcf_ttm"] == -500.0
    assert out["scenarios"] == []
