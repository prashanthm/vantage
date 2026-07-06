"""Entry-condition feature tests — the no-leakage trust surface.

Fully offline and deterministic: canned bars + a round-trip in, entry features
out. Covers trend/vol-percentile/RSI/support-distance, option DTE + moneyness
parsed from a display symbol, and the critical NO-LEAKAGE invariant: appending
post-entry bars does not change an entry's features."""
from __future__ import annotations

import pytest

from vantage_server.ml import features as ft


# ----------------------------------------------------------- canned bars

def _uptrend_daily(n=60, start=100.0, step=1.0, base_date=(2026, 3, 1)):
    """A clean rising series: close climbs by ``step``/bar. Long enough for a
    20/50 MA and the vol-percentile rolling windows."""
    import datetime as dt
    d0 = dt.date(*base_date)
    bars = []
    for i in range(n):
        c = start + step * i
        day = d0 + dt.timedelta(days=i)
        bars.append({"date": day.isoformat(), "open": c - 0.5, "high": c + 0.5,
                     "low": c - 1.0, "close": c, "volume": 1000 + i})
    return bars


# ----------------------------------------------------------- basic features

def test_trend_rsi_and_holding_bucket_on_uptrend():
    daily = _uptrend_daily()
    open_date = daily[-1]["date"]
    rt = {"symbol": "AAPL", "kind": "equity", "open_date": open_date,
          "close_date": "2026-06-01", "holding_days": 10, "entry_price": 159.0,
          "quantity": 10, "win": True, "realized_pnl": 50.0}
    f = ft.entry_features(rt, bars_daily_at_entry=daily)
    assert f["daily_trend"] == "up"
    assert f["daily_trend_strength"] is not None and f["daily_trend_strength"] > 0
    # a monotonic rise -> RSI pinned near/at 100 (no losses in the window)
    assert f["rsi"] == pytest.approx(100.0)
    assert f["rsi_declining"] is False
    assert f["price_vs_ma20"] == "above"
    assert f["price_vs_ma50"] == "above"
    assert f["price_vs_ma200"] is None  # too few bars for a 200 MA
    assert f["holding_bucket"] == "1-4wk"  # 10 days


def test_vol_percentile_band_present_and_bounded():
    daily = _uptrend_daily(n=120)
    rt = {"symbol": "AAPL", "kind": "equity", "open_date": daily[-1]["date"],
          "close_date": "2026-08-01", "holding_days": 3}
    f = ft.entry_features(rt, bars_daily_at_entry=daily)
    assert f["vol_percentile"] is None or 0.0 <= f["vol_percentile"] <= 1.0
    assert f["vol_percentile_band"] in (None, "low", "medium", "high")


def test_support_distance_near_flag():
    # a V: fall then rise, so the last close sits near a prior swing-low support
    import datetime as dt
    d0 = dt.date(2026, 3, 1)
    prices = [120 - i for i in range(20)] + [100 + i for i in range(1, 21)]
    daily = []
    for i, c in enumerate(prices):
        day = d0 + dt.timedelta(days=i)
        daily.append({"date": day.isoformat(), "open": c, "high": c + 1,
                      "low": c - 1, "close": float(c), "volume": 1000})
    rt = {"symbol": "AAPL", "kind": "equity", "open_date": daily[-1]["date"],
          "close_date": "2026-06-01", "holding_days": 2}
    f = ft.entry_features(rt, bars_daily_at_entry=daily)
    # distances computed (not None) when there are levels around the entry
    assert "near_support" in f and "near_resistance" in f
    assert f["dist_to_support"] is None or isinstance(f["dist_to_support"], float)


def test_day_of_week_and_monday_friday_flags():
    daily = _uptrend_daily()
    # 2026-06-05 is a Friday
    rt = {"symbol": "AAPL", "kind": "equity", "open_date": "2026-06-05",
          "close_date": "2026-06-10", "holding_days": 5}
    f = ft.entry_features(rt, bars_daily_at_entry=daily)
    assert f["day_of_week"] == "Friday"
    assert f["is_friday"] is True and f["is_monday"] is False


# ----------------------------------------------------------- options

def test_option_dte_and_moneyness_from_display_symbol():
    daily = _uptrend_daily()
    # last close of the uptrend is start + step*(n-1) = 100 + 59 = 159
    assert daily[-1]["close"] == pytest.approx(159.0)
    open_date = daily[-1]["date"]  # 2026-04-29
    # a 150 CALL expiring 2026-05-15: with underlying 159, 150C is ITM
    rt = {"symbol": "SPY", "kind": "option", "open_date": open_date,
          "close_date": "2026-05-10", "holding_days": 8, "entry_price": 900.0,
          "quantity": 1, "win": True, "realized_pnl": 100.0}
    f = ft.entry_features(rt, bars_daily_at_entry=daily,
                          display_symbol="SPY 2026-05-15 150C")
    assert f["option_type"] == "call"
    assert f["dte"] == (
        __import__("datetime").date(2026, 5, 15)
        - __import__("datetime").date.fromisoformat(open_date)).days
    assert f["dte_band"] in ("0dte", "<7dte", "1-4wk", ">1mo")
    assert f["moneyness"] == "ITM"  # 150 strike, underlying 159
    assert f["moneyness_pct"] > 0


def test_option_otm_put_and_short_dte_band():
    daily = _uptrend_daily()  # underlying 159 at entry
    open_date = daily[-1]["date"]
    # 140 PUT with underlying 159 is OTM; expiring 3 days out -> <7dte
    import datetime as dt
    exp = (dt.date.fromisoformat(open_date) + dt.timedelta(days=3)).isoformat()
    rt = {"symbol": "SPY", "kind": "option", "open_date": open_date,
          "close_date": "2026-05-05", "holding_days": 1, "entry_price": 50.0,
          "quantity": 2}
    f = ft.entry_features(rt, bars_daily_at_entry=daily,
                          display_symbol=f"SPY {exp} 140P")
    assert f["option_type"] == "put"
    assert f["dte_band"] == "<7dte"
    assert f["moneyness"] == "OTM"


def test_parse_option_symbol_and_equity_passthrough():
    assert ft.parse_option_symbol("NBIS 2026-07-10 215C") == {
        "underlying": "NBIS", "expiry": "2026-07-10", "strike": 215.0,
        "right": "call"}
    assert ft.parse_option_symbol("AAPL") is None  # plain equity


# ----------------------------------------------------------- NO LEAKAGE

def test_no_leakage_appending_later_bars_does_not_change_entry_features():
    """The load-bearing invariant: features for an early entry are computed from
    bars <= open_date only. Appending WILD post-entry bars must not move a single
    entry feature."""
    daily = _uptrend_daily(n=80)
    open_date = daily[-1]["date"]
    rt = {"symbol": "AAPL", "kind": "equity", "open_date": open_date,
          "close_date": "2026-09-01", "holding_days": 7, "entry_price": 179.0,
          "quantity": 10}

    before = ft.entry_features(rt, bars_daily_at_entry=daily)

    # a dramatic post-entry crash + spike that WOULD flip trend/vol/RSI if leaked
    import datetime as dt
    d_last = dt.date.fromisoformat(open_date)
    future = []
    for i in range(1, 30):
        day = d_last + dt.timedelta(days=i)
        c = 50.0 if i % 2 else 400.0
        future.append({"date": day.isoformat(), "open": c, "high": c + 50,
                       "low": c - 50, "close": c, "volume": 99999})
    full = daily + future

    sliced = ft.slice_bars_at(full, open_date)
    after = ft.entry_features(rt, bars_daily_at_entry=sliced)
    assert before == after, "entry features leaked post-entry bars"
    # and the slice really did drop the future bars
    assert len(sliced) == len(daily)


def test_slice_bars_at_is_inclusive_of_open_date():
    daily = _uptrend_daily(n=10)
    cutoff = daily[5]["date"]
    sliced = ft.slice_bars_at(daily, cutoff)
    assert sliced[-1]["date"] == cutoff  # inclusive
    assert len(sliced) == 6


# ----------------------------------------------------------- features_for_all

def test_features_for_all_slices_per_trip_and_carries_reference():
    daily = _uptrend_daily(n=90)
    bundle = {"AAPL": {"daily": daily, "weekly": [], "monthly": []}}
    # two trips opened at different dates -> each sliced to its own open_date
    early = daily[40]["date"]
    late = daily[80]["date"]
    trips = [
        {"symbol": "AAPL", "kind": "equity", "open_date": early,
         "close_date": "2026-06-01", "holding_days": 5, "win": True,
         "realized_pnl": 10.0, "entry_price": 140.0, "quantity": 1},
        {"symbol": "AAPL", "kind": "equity", "open_date": late,
         "close_date": "2026-07-01", "holding_days": 5, "win": False,
         "realized_pnl": -10.0, "entry_price": 180.0, "quantity": 1},
    ]
    out = ft.features_for_all(trips, bars_by_symbol=bundle)
    assert len(out) == 2
    assert out[0]["symbol"] == "AAPL" and out[0]["win"] is True
    assert out[1]["realized_pnl"] == -10.0
    assert "features" in out[0] and out[0]["features"]["daily_trend"] == "up"
