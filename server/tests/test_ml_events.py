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


# ------------------------------------------------------------ next_earnings

def test_next_earnings_forward_and_backward():
    r = events.next_earnings(["2026-05-05", "2026-08-04"], "2026-07-11")
    assert r["next_date"] == "2026-08-04"
    assert r["days_until"] == 24
    assert r["last_date"] == "2026-05-05"
    assert r["days_since"] == 67


def test_next_earnings_today_counts_as_future():
    r = events.next_earnings(["2026-07-11"], "2026-07-11")
    assert r["next_date"] == "2026-07-11"
    assert r["days_until"] == 0


def test_next_earnings_past_only_cache_has_no_future_date():
    r = events.next_earnings(["2026-02-03", "2026-05-05"], "2026-07-11")
    assert r["next_date"] is None
    assert r["days_until"] is None
    assert r["last_date"] == "2026-05-05"  # stale-cache signal, not "no earnings"


def test_next_earnings_empty_or_unparseable_is_unknown():
    assert events.next_earnings([], "2026-07-11")["next_date"] is None
    r = events.next_earnings(["not-a-date"], "2026-07-11")
    assert r == {"next_date": None, "days_until": None,
                 "last_date": None, "days_since": None}


# ------------------------------------------------------------ underlyings_from_lots

def test_underlyings_from_lots_normalizes_and_filters(tmp_path):
    import json

    from vantage_server.ml.fetch_earnings import underlyings_from_lots

    # JSON-backend lots file: plain tickers, option display symbols, sleeves,
    # broker option ids and CUSIPs — only real equity underlyings survive.
    (tmp_path / "accounts.json").write_text(json.dumps([
        {"id": "rh-margin", "name": "RH", "broker": "robinhood", "taxable": True},
    ]))
    (tmp_path / "lots.json").write_text(json.dumps([
        {"account": "rh-margin", "symbol": "ACN", "date": "2026-01-05",
         "shares": 10, "cost_per_share": 300.0},
        {"account": "rh-margin", "symbol": "ACN 2028-01-21 160C", "date": "2026-01-05",
         "shares": 1, "cost_per_share": 12.0},
        {"account": "rh-margin", "symbol": "pltr", "date": "2026-02-01",
         "shares": 5, "cost_per_share": 120.0},
        {"account": "rh-margin", "symbol": "CASH", "date": "2026-01-01",
         "shares": 1000, "cost_per_share": 1.0},
        {"account": "rh-margin", "symbol": "CRYPTO", "date": "2026-01-01",
         "shares": 1, "cost_per_share": 50.0},
        {"account": "rh-margin", "symbol": "-ALAB260710C400", "date": "2026-03-01",
         "shares": 1, "cost_per_share": 4.0},
        {"account": "rh-margin", "symbol": "089693105", "date": "2026-03-01",
         "shares": 10, "cost_per_share": 9.0},
    ]))
    assert underlyings_from_lots(tmp_path) == ["ACN", "PLTR"]
