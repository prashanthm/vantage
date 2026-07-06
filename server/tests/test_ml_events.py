"""Earnings-proximity event tests — the deterministic before/during/nearest kernel.

Fully offline: dates in, flags out. Covers earnings BEFORE entry, DURING the
hold, and NEITHER, plus the signed nearest_days and the unknown (no dates) case."""
from __future__ import annotations

from vantage_server.ml import events


def test_earnings_before_entry_within_window():
    # earnings 2 days before a 2026-03-10 entry -> before_entry within window 5
    r = events.earnings_within(
        "2026-03-10", "2026-03-20", ["2026-03-08"], window_days=5)
    assert r["before_entry"] is True
    assert r["during_hold"] is False
    assert r["nearest_days"] == -2  # 2 days before entry


def test_earnings_before_entry_outside_window_is_false():
    # earnings 10 days before entry, window 5 -> not before_entry
    r = events.earnings_within(
        "2026-03-10", "2026-03-20", ["2026-02-28"], window_days=5)
    assert r["before_entry"] is False
    assert r["during_hold"] is False
    assert r["nearest_days"] == -10


def test_earnings_during_hold():
    # entry 2026-03-10, exit 2026-03-25, earnings 2026-03-18 -> during hold
    r = events.earnings_within(
        "2026-03-10", "2026-03-25", ["2026-03-18"], window_days=5)
    assert r["before_entry"] is False
    assert r["during_hold"] is True
    assert r["nearest_days"] == 8


def test_earnings_after_exit_is_neither():
    r = events.earnings_within(
        "2026-03-10", "2026-03-20", ["2026-04-01"], window_days=5)
    assert r["before_entry"] is False
    assert r["during_hold"] is False
    assert r["nearest_days"] == 22  # nearest is still reported


def test_earnings_on_entry_day_counts_as_before():
    r = events.earnings_within("2026-03-10", "2026-03-20", ["2026-03-10"])
    assert r["before_entry"] is True
    assert r["nearest_days"] == 0


def test_open_ended_hold_counts_any_earnings_after_entry():
    # no close_date -> hold is open-ended; earnings after entry is during_hold
    r = events.earnings_within("2026-03-10", None, ["2026-05-01"], window_days=5)
    assert r["during_hold"] is True


def test_no_earnings_dates_is_unknown_not_false():
    r = events.earnings_within("2026-03-10", "2026-03-20", [])
    assert r["before_entry"] is False
    assert r["during_hold"] is False
    assert r["nearest_days"] is None  # unknown, not fabricated


def test_no_open_date_is_unknown():
    r = events.earnings_within(None, "2026-03-20", ["2026-03-18"])
    assert r["nearest_days"] is None


def test_nearest_picks_closest_of_many():
    r = events.earnings_within(
        "2026-03-10", "2026-06-10",
        ["2026-01-01", "2026-03-12", "2026-06-01"], window_days=5)
    assert r["nearest_days"] == 2  # 2026-03-12 is closest to entry


def test_multiple_earnings_before_and_during():
    r = events.earnings_within(
        "2026-03-10", "2026-03-25",
        ["2026-03-07", "2026-03-18"], window_days=5)
    assert r["before_entry"] is True   # 2026-03-07
    assert r["during_hold"] is True    # 2026-03-18
