"""Bayesian condition-bucket tests — the small-n-honest statistics.

Fully offline and deterministic. Covers the Beta-Binomial credible interval
(hand-checked mean + interval bracketing, the 0/0 prior, CI tightening as n
grows), condition_buckets grouping with the mandatory baseline row, and
notable_buckets flagging a clear edge while rejecting a thin bucket as noise."""
from __future__ import annotations

import pytest

from vantage_server.ml import buckets as bk


# ------------------------------------------------------- beta_binomial

def test_beta_binomial_mean_and_interval_brackets():
    # 7 wins / 3 losses: raw rate 0.7; posterior Beta(8,4) mean = 8/12 = 0.6667.
    r = bk.beta_binomial(7, 3)
    assert r["mean"] == pytest.approx(0.6667, abs=1e-3)
    # the 90% credible interval must bracket both the posterior mean and 0.7
    assert r["ci_low"] < r["mean"] < r["ci_high"]
    assert r["ci_low"] < 0.7 < r["ci_high"]
    # hand-checked against the Beta(8,4) 5th/95th percentiles (~0.436 / ~0.865)
    assert r["ci_low"] == pytest.approx(0.4356, abs=1e-3)
    assert r["ci_high"] == pytest.approx(0.8649, abs=1e-3)


def test_beta_binomial_zero_zero_is_the_prior():
    # no data -> the uniform Beta(1,1) prior: mean 0.5, symmetric 90% interval.
    r = bk.beta_binomial(0, 0)
    assert r["mean"] == pytest.approx(0.5)
    assert r["ci_low"] == pytest.approx(0.05, abs=1e-3)
    assert r["ci_high"] == pytest.approx(0.95, abs=1e-3)


def test_beta_binomial_interval_tightens_as_n_grows():
    small = bk.beta_binomial(7, 3)              # n=10
    big = bk.beta_binomial(70, 30)              # n=100, same 0.7 rate
    huge = bk.beta_binomial(700, 300)           # n=1000
    w_small = small["ci_high"] - small["ci_low"]
    w_big = big["ci_high"] - big["ci_low"]
    w_huge = huge["ci_high"] - huge["ci_low"]
    assert w_small > w_big > w_huge  # monotonic tightening
    # all still centered near 0.7
    for r in (small, big, huge):
        assert r["mean"] == pytest.approx(0.7, abs=0.05)


def test_beta_binomial_all_wins_and_all_losses():
    allw = bk.beta_binomial(5, 0)          # posterior Beta(6,1)
    assert allw["mean"] > 0.7
    assert 0.0 < allw["ci_low"] and allw["ci_high"] <= 1.0
    alll = bk.beta_binomial(0, 5)          # posterior Beta(1,6)
    assert alll["mean"] < 0.3
    assert allw["ci_high"] >= alll["ci_high"]


def test_beta_binomial_rejects_negative():
    with pytest.raises(ValueError):
        bk.beta_binomial(-1, 3)


# ------------------------------------------------------- condition_buckets

def _trip(win, pnl, **features):
    return {"symbol": "X", "kind": "equity", "win": win, "realized_pnl": pnl,
            "features": features}


def test_condition_buckets_groups_and_includes_baseline_row():
    trips = [
        _trip(True, 100, daily_trend="up"),
        _trip(True, 50, daily_trend="up"),
        _trip(False, -30, daily_trend="down"),
        _trip(False, -20, daily_trend="down"),
    ]
    rows = bk.condition_buckets(trips, dimensions=("daily_trend",))
    # first row is the mandatory baseline
    assert rows[0]["dimension"] == "__baseline__"
    assert rows[0]["value"] == "all_trades"
    assert rows[0]["n"] == 4
    assert rows[0]["win_rate"] == pytest.approx(0.5)
    # one bucket per distinct value
    by_val = {r["value"]: r for r in rows if r["dimension"] == "daily_trend"}
    assert set(by_val) == {"up", "down"}
    assert by_val["up"]["n"] == 2 and by_val["up"]["win_rate"] == pytest.approx(1.0)
    assert by_val["down"]["win_rate"] == pytest.approx(0.0)
    # $ aggregates
    assert by_val["up"]["total_pnl"] == pytest.approx(150.0)
    assert by_val["up"]["avg_pnl"] == pytest.approx(75.0)


def test_condition_buckets_skips_none_feature_values():
    trips = [
        _trip(True, 10, moneyness="ITM"),
        _trip(False, -10, moneyness=None),  # equity-like: no moneyness
        _trip(True, 10, moneyness="ITM"),
    ]
    rows = bk.condition_buckets(trips, dimensions=("moneyness",))
    vals = {r["value"] for r in rows if r["dimension"] == "moneyness"}
    assert vals == {"ITM"}  # None never forms a phantom bucket


def test_condition_buckets_stringifies_booleans():
    trips = [
        _trip(True, 10, near_support=True),
        _trip(False, -10, near_support=False),
    ]
    rows = bk.condition_buckets(trips, dimensions=("near_support",))
    vals = {r["value"] for r in rows if r["dimension"] == "near_support"}
    assert vals == {"true", "false"}


# ------------------------------------------------------- notable_buckets

def test_notable_flags_a_clear_edge_and_marks_thin_bucket():
    # a strong, well-populated edge: 12 trips at "up", all wins, baseline 0.5.
    up = [_trip(True, 10, daily_trend="up") for _ in range(12)]
    down = [_trip(False, -10, daily_trend="down") for _ in range(12)]
    trips = up + down
    baseline = bk.baseline_win_rate(trips)
    assert baseline == pytest.approx(0.5)
    rows = bk.condition_buckets(trips, dimensions=("daily_trend",))
    notable = bk.notable_buckets(rows, baseline=baseline, min_n=3)
    kinds = {(n["value"], n["kind"]) for n in notable}
    assert ("up", "edge") in kinds     # ci_low > 0.5
    assert ("down", "leak") in kinds   # ci_high < 0.5
    for n in notable:
        assert n["significant"] is True


def test_notable_rejects_small_n_as_noise():
    # a 2-trip "100% win" bucket is NOT statistically defensible: its CI is too
    # wide to separate from a 0.5 baseline. Add bulk baseline trips at 0.5.
    bulk = [_trip(i % 2 == 0, 10 if i % 2 == 0 else -10, daily_trend="side")
            for i in range(20)]
    tiny = [_trip(True, 10, daily_trend="up"), _trip(True, 10, daily_trend="up")]
    trips = bulk + tiny
    baseline = bk.baseline_win_rate(trips)
    rows = bk.condition_buckets(trips, dimensions=("daily_trend",))
    notable = bk.notable_buckets(rows, baseline=baseline, min_n=3)
    # the 2-trip "up" bucket does not clear the CI-separation bar -> not notable
    up_notables = [n for n in notable if n["value"] == "up"]
    assert up_notables == []


def test_notable_thin_but_separated_marked_not_significant():
    # construct a bucket that DOES separate on CI but has n below min_n by using
    # a large prior-free separation: 0 wins / 2 losses vs a 0.9 baseline.
    losers = [_trip(False, -10, dte_band="0dte"), _trip(False, -10, dte_band="0dte")]
    winners = [_trip(True, 10, dte_band="swing") for _ in range(30)]
    trips = losers + winners
    baseline = bk.baseline_win_rate(trips)  # 30/32 ~ 0.9375
    rows = bk.condition_buckets(trips, dimensions=("dte_band",))
    notable = bk.notable_buckets(rows, baseline=baseline, min_n=5)
    zdte = [n for n in notable if n["value"] == "0dte"]
    # 0/2 with ci_high well under 0.9375 separates, but n=2 < min_n=5
    assert zdte and zdte[0]["significant"] is False
    assert zdte[0]["note"] == "n<min, not significant"
    assert zdte[0]["kind"] == "leak"


def test_notable_empty_when_no_baseline():
    assert bk.notable_buckets([], baseline=None) == []


def test_baseline_win_rate_none_on_empty():
    assert bk.baseline_win_rate([]) is None
