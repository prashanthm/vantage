"""OHLCV resampling + the snapshot orchestrator.

resample: daily -> weekly/monthly OHLCV correctness (open=first, high=max,
low=min, close=last, volume=sum) on a hand-checked calendar-spanning series.
snapshot_bars: orchestration with a STUBBED fetch (no network) — the daily
bars flow straight through and weekly/monthly are derived from them.
"""
from __future__ import annotations

import datetime as _dt

import pytest

from vantage_server.bars import BarsError, resample, snapshot_bars


# A hand-checked series spanning two ISO weeks (Jun 1-5 = week 23, Jun 8-9 =
# week 24) inside one month.
DAILY = [
    {"date": "2026-06-01", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 100},
    {"date": "2026-06-02", "open": 11, "high": 13, "low": 10, "close": 12, "volume": 100},
    {"date": "2026-06-03", "open": 12, "high": 14, "low": 8, "close": 13, "volume": 100},
    {"date": "2026-06-04", "open": 13, "high": 15, "low": 11, "close": 14, "volume": 100},
    {"date": "2026-06-05", "open": 14, "high": 16, "low": 12, "close": 15, "volume": 100},
    {"date": "2026-06-08", "open": 15, "high": 20, "low": 7, "close": 16, "volume": 200},
    {"date": "2026-06-09", "open": 16, "high": 18, "low": 14, "close": 17, "volume": 200},
]


def test_resample_weekly_ohlcv_aggregation():
    weekly = resample(DAILY, "week")
    assert weekly == [
        # week 23 (Jun 1-5): open=first, high=max, low=min, close=last, vol=sum
        {"date": "2026-06-01", "open": 10.0, "high": 16.0, "low": 8.0,
         "close": 15.0, "volume": 500},
        # week 24 (Jun 8-9)
        {"date": "2026-06-08", "open": 15.0, "high": 20.0, "low": 7.0,
         "close": 17.0, "volume": 400},
    ]


def test_resample_monthly_ohlcv_aggregation():
    monthly = resample(DAILY, "month")
    assert monthly == [
        {"date": "2026-06-01", "open": 10.0, "high": 20.0, "low": 7.0,
         "close": 17.0, "volume": 900},
    ]


def test_resample_splits_months():
    daily = [
        {"date": "2026-06-29", "open": 10, "high": 11, "low": 9, "close": 10, "volume": 5},
        {"date": "2026-06-30", "open": 10, "high": 12, "low": 9, "close": 11, "volume": 5},
        {"date": "2026-07-01", "open": 11, "high": 15, "low": 10, "close": 14, "volume": 7},
    ]
    monthly = resample(daily, "month")
    assert [b["date"] for b in monthly] == ["2026-06-29", "2026-07-01"]
    assert monthly[0]["close"] == 11.0 and monthly[0]["volume"] == 10
    assert monthly[1]["open"] == 11.0 and monthly[1]["high"] == 15.0


def test_resample_handles_iso_timestamps_with_z():
    daily = [
        {"date": "2026-06-01T00:00:00Z", "open": 1, "high": 2, "low": 1,
         "close": 2, "volume": 10},
        {"date": "2026-06-02T00:00:00Z", "open": 2, "high": 3, "low": 1,
         "close": 3, "volume": 10},
    ]
    weekly = resample(daily, "week")
    assert len(weekly) == 1
    assert weekly[0]["high"] == 3.0 and weekly[0]["volume"] == 20


def test_resample_rejects_unknown_timeframe():
    with pytest.raises(BarsError):
        resample(DAILY, "quarter")


def test_resample_empty_series():
    assert resample([], "week") == []
    assert resample([], "month") == []


# --------------------------------------------------------- snapshot orchestrator

def test_snapshot_bars_derives_weekly_and_monthly_from_stubbed_fetch():
    calls = []

    def fake_fetch(symbol, *, start_time, interval="day"):
        calls.append((symbol, start_time, interval))
        return DAILY

    snap = snapshot_bars(["pltr"], today=_dt.date(2026, 7, 5),
                         lookback_days=400, fetch=fake_fetch)
    assert set(snap) == {"PLTR"}
    series = snap["PLTR"]
    assert series["daily"] == DAILY
    assert series["weekly"] == resample(DAILY, "week")
    assert series["monthly"] == resample(DAILY, "month")

    # start_time = today - lookback_days at 00:00:00Z; daily interval requested
    sym, start, interval = calls[0]
    assert sym == "PLTR"
    assert interval == "day"
    expected_start = (_dt.date(2026, 7, 5) - _dt.timedelta(days=400)).isoformat()
    assert start == f"{expected_start}T00:00:00Z"


def test_snapshot_bars_multiple_symbols():
    def fake_fetch(symbol, *, start_time, interval="day"):
        return DAILY if symbol == "AAA" else []

    snap = snapshot_bars(["AAA", "BBB"], today=_dt.date(2026, 7, 5),
                         fetch=fake_fetch)
    assert snap["AAA"]["daily"] == DAILY
    assert snap["BBB"] == {"daily": [], "weekly": [], "monthly": []}
