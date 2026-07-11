"""Growth/quality derivation: TTM math, capex sign, nullability, cache.

All tests inject normalized statement dicts (the shape _yf_statements produces)
so none touch the network. The disk cache is exercised at a temp dir.
"""
from __future__ import annotations

import datetime as _dt
import json

from vantage_server.growth import _derive, growth


def _q(period, revenue=None, gross=None, opinc=None):
    return {"period": period, "total_revenue": revenue,
            "gross_profit": gross, "operating_income": opinc}


def _cf(period, ocf=None, capex=None, fcf=None, sbc=None):
    return {"period": period, "operating_cash_flow": ocf,
            "capital_expenditure": capex, "free_cash_flow": fcf,
            "stock_based_compensation": sbc}


def _raw_eight_quarters():
    """Two full TTM windows: current TTM revenue 440, prior 400 (yoy=+10%)."""
    qi = [
        _q("2026-03-31", revenue=115, gross=92, opinc=23),
        _q("2025-12-31", revenue=112, gross=89, opinc=22),
        _q("2025-09-30", revenue=108, gross=86, opinc=21),
        _q("2025-06-30", revenue=105, gross=84, opinc=21),
        _q("2025-03-31", revenue=103, gross=82, opinc=20),
        _q("2024-12-31", revenue=101, gross=80, opinc=20),
        _q("2024-09-30", revenue=99, gross=79, opinc=19),
        _q("2024-06-30", revenue=97, gross=77, opinc=19),
    ]
    qc = [
        _cf("2026-03-31", ocf=40, capex=-10, sbc=8),
        _cf("2025-12-31", ocf=38, capex=-9, sbc=8),
        _cf("2025-09-30", ocf=36, capex=-9, sbc=7),
        _cf("2025-06-30", ocf=34, capex=-8, sbc=7),
    ]
    return {"quarterly_income": qi, "quarterly_cashflow": qc, "annual_income": []}


# ------------------------------------------------------------ derivation

def test_derive_ttm_revenue_and_yoy():
    d = _derive(_raw_eight_quarters(), "acme")
    assert d["symbol"] == "ACME"
    assert d["revenue_ttm"] == 440.0
    assert abs(d["revenue_yoy"] - 0.10) < 1e-9
    assert d["revenue_yoy_basis"] == "ttm"
    assert d["period_end"] == "2026-03-31"


def test_derive_fcf_from_ocf_plus_negative_capex():
    d = _derive(_raw_eight_quarters(), "ACME")
    # OCF 148 + capex (-36) = 112 — capex is reported negative, added not subtracted
    assert d["fcf_ttm"] == 112.0
    assert abs(d["fcf_margin"] - 112.0 / 440.0) < 1e-9


def test_derive_prefers_reported_fcf_row_over_derivation():
    raw = _raw_eight_quarters()
    for e in raw["quarterly_cashflow"]:
        e["free_cash_flow"] = 30
    d = _derive(raw, "ACME")
    assert d["fcf_ttm"] == 120.0


def test_derive_margins_and_sbc():
    d = _derive(_raw_eight_quarters(), "ACME")
    assert abs(d["gross_margin"] - 351.0 / 440.0) < 1e-9
    assert abs(d["operating_margin"] - 87.0 / 440.0) < 1e-9
    assert d["sbc_ttm"] == 30.0
    assert abs(d["sbc_pct_revenue"] - 30.0 / 440.0) < 1e-9


def test_rule_of_40_pins_its_basis():
    d = _derive(_raw_eight_quarters(), "ACME")
    expected = 0.10 * 100 + (112.0 / 440.0) * 100
    assert abs(d["rule_of_40"] - expected) < 1e-6
    assert d["rule_of_40_basis"] == "yoy_growth_plus_fcf_margin"


def test_yoy_falls_back_to_annual_when_under_eight_quarters():
    raw = {
        "quarterly_income": [_q("2026-03-31", revenue=115)],
        "quarterly_cashflow": [],
        "annual_income": [_q("2025-12-31", revenue=430), _q("2024-12-31", revenue=400)],
    }
    d = _derive(raw, "ACME")
    assert d["revenue_ttm"] is None
    assert abs(d["revenue_yoy"] - 0.075) < 1e-9
    assert d["revenue_yoy_basis"] == "annual"


def test_missing_rows_null_downstream_never_estimated():
    raw = _raw_eight_quarters()
    for e in raw["quarterly_cashflow"]:
        e["operating_cash_flow"] = None
    d = _derive(raw, "ACME")
    assert d["fcf_ttm"] is None
    assert d["fcf_margin"] is None
    assert d["rule_of_40"] is None
    assert d["rule_of_40_basis"] is None


# ------------------------------------------------------------ fetch + cache

def test_empty_statements_return_none_etf_case(tmp_path):
    out = growth("VOO", tmp_path, fetch=lambda s: {
        "quarterly_income": [], "quarterly_cashflow": [], "annual_income": []})
    assert out is None


def test_fetch_error_returns_none(tmp_path):
    def boom(sym):
        raise RuntimeError("network down")
    assert growth("ACME", tmp_path, fetch=boom) is None


def test_cache_hit_skips_fetch_within_ttl(tmp_path):
    calls = []

    def fetch(sym):
        calls.append(sym)
        return _raw_eight_quarters()

    t0 = _dt.datetime(2026, 7, 1, tzinfo=_dt.timezone.utc)
    first = growth("ACME", tmp_path, fetch=fetch, clock=lambda: t0)
    again = growth("ACME", tmp_path, fetch=fetch,
                   clock=lambda: t0 + _dt.timedelta(days=1))
    assert first == again
    assert calls == ["ACME"]  # second call served from cache (7d TTL)


def test_cache_expires_after_ttl(tmp_path):
    calls = []

    def fetch(sym):
        calls.append(sym)
        return _raw_eight_quarters()

    t0 = _dt.datetime(2026, 7, 1, tzinfo=_dt.timezone.utc)
    growth("ACME", tmp_path, fetch=fetch, ttl=3600, clock=lambda: t0)
    growth("ACME", tmp_path, fetch=fetch, ttl=3600,
           clock=lambda: t0 + _dt.timedelta(hours=2))
    assert calls == ["ACME", "ACME"]


def test_cache_file_is_json_with_value(tmp_path):
    growth("ACME", tmp_path, fetch=lambda s: _raw_eight_quarters())
    cached = json.loads((tmp_path / "growth_cache" / "ACME.json").read_text())
    assert cached["value"]["revenue_ttm"] == 440.0
