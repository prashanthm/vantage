"""OHLCV resampling + the snapshot orchestrator.

resample: daily -> weekly/monthly OHLCV correctness (open=first, high=max,
low=min, close=last, volume=sum) on a hand-checked calendar-spanning series.
snapshot_bars: orchestration with a STUBBED fetch (no network) — the daily
bars flow straight through and weekly/monthly are derived from them.
"""
from __future__ import annotations

import datetime as _dt

import pytest

from vantage_server.bars import (
    BarsError,
    backfill_bars,
    merge_daily,
    resample,
    snapshot_bars,
    trim_padding,
)


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


# ----------------------------------------------------------- trim_padding

def _pad_row(date: str) -> dict:
    """A degenerate pre-IPO padding row: zero volume, flat/zero OHLC."""
    return {"date": date, "open": 0, "high": 0, "low": 0, "close": 0, "volume": 0}


def _real_row(date: str, base: float) -> dict:
    return {"date": date, "open": base, "high": base + 2, "low": base - 1,
            "close": base + 1, "volume": 1_000_000}


def test_trim_padding_drops_leading_padding_keeps_real_history():
    # 50 pad rows (2015 pre-IPO placeholders) + 200 real trading bars.
    pad = [_pad_row(f"2015-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}") for i in range(50)]
    real = [_real_row(f"2020-{(i // 28) + 1:02d}-{(i % 28) + 1:02d}", 100 + i)
            for i in range(200)]
    trimmed = trim_padding(pad + real)
    assert len(trimmed) == 200
    assert trimmed == real  # exact real history preserved, unchanged
    assert trimmed[0]["date"].startswith("2020-")


def test_trim_padding_treats_flat_and_zero_volume_and_zero_price_as_padding():
    rows = [
        {"date": "2019-01-01", "open": 5, "high": 5, "low": 5, "close": 5, "volume": 10},  # flat OHLC
        {"date": "2019-01-02", "open": 6, "high": 7, "low": 5, "close": 6, "volume": 0},   # zero volume
        {"date": "2019-01-03", "open": 0, "high": 3, "low": 0, "close": 2, "volume": 50},  # zero price
        _real_row("2019-01-04", 20),  # first real bar
        _real_row("2019-01-05", 21),
    ]
    trimmed = trim_padding(rows)
    assert len(trimmed) == 2
    assert trimmed[0]["date"] == "2019-01-04"


def test_trim_padding_preserves_a_later_zero_volume_holiday_bar():
    # A legitimate mid-history zero-volume bar must NOT be trimmed (only leading
    # rows are padding — we stop at the first real bar).
    rows = [
        _real_row("2021-01-04", 10),
        {"date": "2021-01-05", "open": 11, "high": 12, "low": 10, "close": 11, "volume": 0},
        _real_row("2021-01-06", 12),
    ]
    trimmed = trim_padding(rows)
    assert len(trimmed) == 3
    assert trimmed[1]["volume"] == 0  # the interior holiday bar survives


def test_trim_padding_all_padding_returns_empty():
    assert trim_padding([_pad_row("2015-01-01"), _pad_row("2015-01-02")]) == []
    assert trim_padding([]) == []


# ----------------------------------------------------------- merge_daily

def test_merge_daily_unions_by_date_incoming_wins_no_history_loss():
    existing = [
        {"date": "2020-06-01", "open": 1, "high": 1, "low": 1, "close": 1, "volume": 10},
        {"date": "2020-06-02", "open": 2, "high": 2, "low": 2, "close": 2, "volume": 10},
        {"date": "2020-06-03", "open": 3, "high": 3, "low": 3, "close": 3, "volume": 10},
    ]
    incoming = [
        {"date": "2020-06-03", "open": 9, "high": 9, "low": 9, "close": 9, "volume": 99},  # correction
        {"date": "2020-06-04", "open": 4, "high": 4, "low": 4, "close": 4, "volume": 10},  # new
    ]
    merged = merge_daily(existing, incoming)
    assert [b["date"] for b in merged] == ["2020-06-01", "2020-06-02", "2020-06-03", "2020-06-04"]
    # incoming wins the collision on 06-03
    assert next(b for b in merged if b["date"] == "2020-06-03")["close"] == 9
    # the deep tail (06-01/06-02) is retained
    assert merged[0]["close"] == 1


def test_merge_daily_handles_iso_timestamp_dates_and_sorts():
    existing = [{"date": "2020-06-02T00:00:00Z", "open": 2, "high": 2, "low": 2,
                 "close": 2, "volume": 10}]
    incoming = [{"date": "2020-06-01T00:00:00Z", "open": 1, "high": 1, "low": 1,
                 "close": 1, "volume": 10}]
    merged = merge_daily(existing, incoming)
    assert [b["date"][:10] for b in merged] == ["2020-06-01", "2020-06-02"]


# ----------------------------------------------------------- backfill_bars

def test_backfill_bars_trims_padding_and_derives_from_full_history():
    pad = [_pad_row(f"2015-01-{i + 1:02d}") for i in range(10)]
    real = [_real_row(f"2020-06-{i + 1:02d}", 100 + i) for i in range(20)]

    seen = {}

    def fake_fetch(symbol, *, start_time, interval="day"):
        seen["start_time"] = start_time
        return pad + real

    out = backfill_bars(["pltr"], fetch=fake_fetch)
    assert set(out) == {"PLTR"}
    daily = out["PLTR"]["daily"]
    assert len(daily) == 20                    # padding trimmed
    assert daily[0]["date"].startswith("2020-")
    # weekly/monthly derived from the trimmed daily
    assert out["PLTR"]["weekly"] == resample(daily, "week")
    assert out["PLTR"]["monthly"] == resample(daily, "month")
    # requests from the deep 2015 floor
    assert seen["start_time"].startswith("2015-")
