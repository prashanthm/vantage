"""Relative strength: trailing returns, beta, idio decomposition, degradation."""
from __future__ import annotations

from vantage_server.relative_strength import (
    beta_vs,
    decompose,
    trailing_return,
)


def _series(*closes, start="2026-01-01"):
    import datetime as dt
    d0 = dt.date.fromisoformat(start)
    return [{"date": (d0 + dt.timedelta(days=i)).isoformat(),
             "close": c, "volume": 1000} for i, c in enumerate(closes)]


def test_trailing_return_basic():
    daily = _series(*[100 + i for i in range(30)])
    # 5 trading days back: 129/124 - 1
    assert abs(trailing_return(daily, 5) - (129 / 124 - 1)) < 1e-9


def test_trailing_return_insufficient_history_is_none():
    assert trailing_return(_series(100, 101), 5) is None


def test_beta_of_scaled_series_is_the_scale():
    import math
    bench = _series(*[100 * math.exp(0.001 * i * (-1) ** i) for i in range(200)])
    # name moves exactly 2x the benchmark's daily returns
    name_closes, level = [], 100.0
    prev = bench[0]["close"]
    for b in bench:
        r = b["close"] / prev - 1.0
        level *= (1 + 2 * r)
        name_closes.append(level)
        prev = b["close"]
    name = _series(*name_closes)
    assert abs(beta_vs(name, bench) - 2.0) < 0.05


def test_beta_insufficient_overlap_is_none():
    assert beta_vs(_series(*range(100, 120)), _series(*range(100, 120))) is None


def test_decompose_full_and_degraded():
    name = _series(*[100 + i * 0.5 for i in range(200)])
    spy = _series(*[300 + i * 0.3 for i in range(200)])
    out = decompose("PLTR", name, spy, None, "XLK")
    assert out["symbol"] == "PLTR"
    assert out["sector_etf"] == "XLK"
    assert out["r_1m"] is not None and out["spy_r_1m"] is not None
    assert out["sector_r_1m"] is None  # sector bars absent -> null, not invented
    assert out["beta_spy"] is not None
    assert out["idio_r_1m"] is not None
    assert out["benchmark_available"] is True

    bare = decompose("ZZZ", name, None, None, None)
    assert bare["benchmark_available"] is False
    assert bare["beta_spy"] is None and bare["idio_r_1m"] is None
