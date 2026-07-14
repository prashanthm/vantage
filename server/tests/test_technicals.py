"""Deterministic technical-analysis engine — the trust tests.

Every assertion is against a CANNED bar series with KNOWN structure: swing
pivots at the bars we placed them, volume shelves at the high-volume zones,
S/R clustering of nearby pivots, trend on synthetic up/down/range series, a
PINNED Wilder RSI value hand-checked against the classic worked example, and
the two scenarios that flip the recommendation — "broke support with momentum"
(freefall) vs "sitting at support, basing" (strong). Pure, offline.
"""
from __future__ import annotations

import pytest

from vantage_server import technicals as T
from vantage_server.bars import resample


# ------------------------------------------------------------- bar builders

def _bars(rows, *, start_month=1):
    """rows: list of (close, high, low, volume). Dates run sequentially so the
    resampler can bucket them; index maps to a real calendar date."""
    out = []
    for i, (c, h, low, v) in enumerate(rows):
        out.append({
            "date": f"2026-{start_month + i // 28:02d}-{(i % 28) + 1:02d}",
            "open": float(c), "high": float(h), "low": float(low),
            "close": float(c), "volume": int(v),
        })
    return out


def _flat(prices, *, spread=1, volume=1000):
    return _bars([(p, p + spread, p - spread, volume) for p in prices])


# --------------------------------------------------------------- swing pivots

def test_swing_pivots_found_at_the_right_bars():
    # V-shaped lows at index 9 (price 90) and a peak at index 3 & 15 (110)
    prices = [100, 102, 104, 110, 104, 102, 100, 98, 96, 90,
              96, 98, 100, 102, 108, 110, 108, 104, 102, 100]
    bars = _flat(prices)  # highs are price+1, lows price-1
    piv = T.swing_pivots(bars, lookback=2)
    assert [(p.date, p.price) for p in piv["highs"]] == [
        ("2026-01-04", 111.0), ("2026-01-16", 111.0)]
    assert [(p.date, p.price) for p in piv["lows"]] == [
        ("2026-01-10", 89.0)]


def test_swing_pivots_exclude_edges_and_respect_lookback():
    bars = _flat([1, 5, 1, 1, 1, 1, 1])
    # index 1 is a high but with lookback 2 it lacks 2 bars on the left
    assert T.swing_pivots(bars, lookback=2)["highs"] == []
    # with lookback 1 it qualifies
    assert [p.price for p in T.swing_pivots(bars, lookback=1)["highs"]] == [6.0]


# --------------------------------------------------------------- volume shelf

def test_volume_shelves_at_high_volume_price_zones():
    # price alternates 50 (huge volume) / 60 (tiny volume)
    rows = []
    for i in range(30):
        p = 50 if i % 2 == 0 else 60
        vol = 100_000 if p == 50 else 1_000
        rows.append((p, p + 1, p - 1, vol))
    profile = T.volume_profile(_bars(rows), bins=12)
    shelves = [vb for vb in profile if vb.is_shelf]
    assert len(shelves) == 1
    shelf = shelves[0]
    # the shelf spans the 50 price zone, not the 60 one
    assert shelf.low <= 50 <= shelf.high
    assert shelf.high < 60
    assert shelf.volume >= 100_000


# --------------------------------------------------------- support/resistance

def test_support_resistance_clusters_two_nearby_pivots_into_one_zone():
    # two swing lows a hair apart (90.0 and 90.5) must collapse to ONE support
    prices = [100, 102, 104, 110, 104, 102, 100, 98, 96, 90.0,
              96, 98, 100, 102, 108, 110, 108, 104, 102, 100, 98, 96, 90.5,
              96, 98, 100]
    bars = _flat(prices)
    sr = T.support_resistance(bars, current_price=100, lookback=2, cluster_pct=0.03)
    assert len(sr["support"]) == 1
    zone = sr["support"][0]
    assert zone.pivots == 2                 # both lows merged
    assert 88 < zone.price < 90             # ~ (89.0 + 89.5) / 2
    assert zone.kind == "support"


def test_support_resistance_ranks_volume_backed_level_higher():
    # two separated support pivots; only the deep one (80) sits on a volume shelf
    prices = [110, 105, 100, 80, 100, 105, 110, 105, 100, 90, 100, 105, 110]
    rows = [(p, p + 1, p - 1, 800_000 if p == 80 else 1_000) for p in prices]
    bars = _bars(rows)
    sr = T.support_resistance(bars, current_price=112, lookback=2, cluster_pct=0.02)
    prices_seen = {round(lv.price): lv for lv in sr["support"]}
    assert 79 in prices_seen and 89 in prices_seen
    shelf_level = prices_seen[79]
    plain_level = prices_seen[89]
    assert shelf_level.shelf_backed is True
    assert plain_level.shelf_backed is False
    # volume-backed level carries the +1 shelf bonus -> strictly stronger
    assert shelf_level.strength > plain_level.strength


def test_support_and_resistance_split_by_current_price():
    prices = [100, 98, 96, 90, 96, 100, 104, 110, 104, 100]
    bars = _flat(prices)
    sr = T.support_resistance(bars, current_price=100, lookback=2)
    assert all(lv.price <= 100 for lv in sr["support"])
    assert all(lv.price > 100 for lv in sr["resistance"])


# ----------------------------------------------------------------- trend

def test_trend_up_on_synthetic_uptrend():
    tr = T.trend(_flat([100 + i for i in range(60)]))
    assert tr.direction == "up"
    assert tr.strength > 0


def test_trend_down_on_synthetic_downtrend():
    tr = T.trend(_flat([200 - i for i in range(60)]))
    assert tr.direction == "down"
    assert tr.strength > 0


def test_trend_sideways_on_range():
    tr = T.trend(_flat([100 + (5 if i % 2 else -5) for i in range(60)]))
    assert tr.direction == "sideways"
    assert tr.strength == 0.0


def test_trend_structure_hh_hl_and_lh_ll():
    up = [80, 82, 84, 82, 80, 84, 86, 88, 86, 84, 88, 90, 92, 90, 88, 92]
    assert T._swing_structure(_flat(up), lookback=2) in ("HH-HL", "mixed")
    down = [92, 90, 88, 90, 92, 88, 86, 84, 86, 88, 84, 82, 80, 82, 84, 80]
    assert T._swing_structure(_flat(down), lookback=2) in ("LH-LL", "mixed")


# ------------------------------------------------------------------- RSI

# Classic Wilder / StockCharts worked example: 15 closes -> RSI(14) ~= 70.46.
WILDER_CLOSES = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
                 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]


def test_rsi_matches_hand_computed_value():
    value = T.rsi(WILDER_CLOSES, 14)
    assert value == pytest.approx(70.464, abs=0.01)


def test_rsi_all_gains_is_100_and_insufficient_is_none():
    assert T.rsi([float(i) for i in range(1, 20)], 14) == 100.0
    assert T.rsi([1.0, 2.0, 3.0], 14) is None


# --------------------------------------------------------- momentum flags

def test_momentum_declining_accelerating_expanding_flags():
    # long enough for RSI-now and RSI-prev (>= period+2 closes), ending in an
    # accelerating decline (deltas -1, -2, -3, -4) with a widening true range
    rows = []
    # choppy climb (RSI settles mid-band) then an accelerating decline
    prices = [50, 51, 50, 52, 51, 53, 52, 54, 53, 55, 54, 56, 55, 57, 56, 58,
              57, 59, 58, 57, 55, 52, 48]
    n = len(prices)
    for i, p in enumerate(prices):
        spread = 1 if i < n - 4 else (2 + (i - (n - 4)))  # widen at the tail
        rows.append((p, p + spread, p - spread, 1000))
    mom = T.momentum(_bars(rows))
    assert mom.declining is True
    assert mom.accelerating_decline is True
    assert mom.range_expanding is True
    assert mom.rsi < 50  # weakening into the decline


def test_momentum_rsi_defaults_neutral_when_uncomputable():
    # too few bars for RSI(14): rsi defaults to 50.0 (neutral), NOT a
    # fabricated 0.0 that would read as maximally weak; flags stay False
    mom = T.momentum(_flat([10, 11, 12, 11, 10]))
    assert mom.rsi == 50.0
    assert mom.declining is False


def test_momentum_flags_false_on_calm_series():
    mom = T.momentum(_flat([90, 91, 90, 91, 90, 91, 90, 91, 90, 91, 90, 91, 90,
                            91, 90, 91, 90, 91]))
    assert mom.accelerating_decline is False
    assert mom.range_expanding is False


# --------------------------------------- THE two recommendation-flipping cases

# FREEFALL: floor at 90 held twice (double bottom), then a fresh break to 80
# with an ACCELERATING decline (deltas -1,-2,-3,-4) and EXPANDING range.
FREEFALL_PRICES = [110, 108, 106, 104, 102, 100, 98, 96, 94, 92, 90,
                   92, 94, 96, 98, 100, 98, 96, 94, 92, 90,   # second test of 90
                   89, 87, 84, 80]                            # the break, accelerating


def _freefall_daily():
    head = 21  # bars before the break
    rows = []
    for i, p in enumerate(FREEFALL_PRICES):
        spread = 1 if i < head else 2 + (i - head)  # 2,3,4,5 expanding
        rows.append((p, p + spread, p - spread, 1000))
    return _bars(rows)


def test_broke_support_with_momentum_true_on_break_with_momentum():
    daily = _freefall_daily()
    mtf = T.multi_timeframe_read(daily, resample(daily, "week"),
                                 resample(daily, "month"), current_price=80.0)
    assert mtf.broke_support_with_momentum is True
    # the broken floor sits overhead at ~89 (price fell through it)
    assert mtf.factors["broken_support_price"] == pytest.approx(89.0, abs=1.0)
    mom = mtf.per_tf["daily"].momentum
    assert mom.declining and (mom.accelerating_decline or mom.range_expanding)


def test_conviction_freefall_on_break_with_momentum():
    daily = _freefall_daily()
    mtf = T.multi_timeframe_read(daily, resample(daily, "week"),
                                 resample(daily, "month"), current_price=80.0)
    assert mtf.conviction.label == "freefall"
    assert mtf.conviction.score == -1.0


# BASING: calm base oscillating around 90-94 after a prior climb; current sits
# AT the 90 support, range quiet, RSI mid-band, weekly/monthly not both down.
BASING_PRICES = [80, 82, 84, 86, 88, 90, 92, 94, 93, 92, 91, 90, 91, 92, 93, 94,
                 93, 92, 91, 90, 91, 92, 93, 94, 93, 92, 91, 90, 91, 92, 93, 92,
                 91, 90]


def _basing_daily():
    return _flat(BASING_PRICES)


def test_broke_support_with_momentum_false_when_basing_at_support():
    daily = _basing_daily()
    mtf = T.multi_timeframe_read(daily, resample(daily, "week"),
                                 resample(daily, "month"), current_price=90.0)
    assert mtf.broke_support_with_momentum is False
    assert mtf.at_support is True
    assert mtf.factors["broken_support_price"] is None


def test_conviction_strong_when_basing_at_support():
    daily = _basing_daily()
    mtf = T.multi_timeframe_read(daily, resample(daily, "week"),
                                 resample(daily, "month"), current_price=90.0)
    assert mtf.conviction.label == "strong"
    assert mtf.conviction.score >= 0.5
    assert mtf.factors["basing"] is True


def test_multi_timeframe_read_populates_all_timeframes():
    daily = _basing_daily()
    mtf = T.multi_timeframe_read(daily, resample(daily, "week"),
                                 resample(daily, "month"), current_price=90.0)
    assert set(mtf.per_tf) == {"daily", "weekly", "monthly"}
    for tf in mtf.per_tf.values():
        assert isinstance(tf.trend, T.Trend)
        assert isinstance(tf.momentum, T.Momentum)
        assert "support" in tf.support_resistance
        assert "resistance" in tf.support_resistance


# ----------------------------------------------------- covered-call strikes

def test_distance_to_resistance_lists_levels_above_current():
    prices = [100, 98, 96, 90, 96, 100, 104, 110, 104, 100, 104, 112, 108, 100]
    bars = _flat(prices)
    out = T.distance_to_resistance(bars, current_price=100.0, lookback=2)
    assert out, "expected at least one resistance above current"
    assert all(r["price"] > 100 for r in out)
    assert all(r["pct_away"] > 0 for r in out)
    # sorted nearest first
    assert out == sorted(out, key=lambda r: r["pct_away"])


def test_volume_profile_drops_nan_bars():
    """Live 2026-07-13 regression: one NaN close in an EOD bar feed crashed
    the nightly position-analysis job (int(NaN) in the binning). Poisoned
    bars carry no information — they are dropped, the rest still bin."""
    rows = [(50, 51, 49, 10_000)] * 5
    bars = _bars(rows)
    bars.append({"date": "2026-07-13", "open": float("nan"),
                 "high": float("nan"), "low": float("nan"),
                 "close": float("nan"), "volume": float("nan")})
    profile = T.volume_profile(bars, bins=4)
    assert profile and sum(vb.volume for vb in profile) == 50_000

    all_nan = [{"date": "x", "open": float("nan"), "high": float("nan"),
                "low": float("nan"), "close": float("nan"),
                "volume": float("nan")}]
    assert T.volume_profile(all_nan, bins=4) == []
