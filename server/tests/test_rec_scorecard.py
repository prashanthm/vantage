"""Recommendation scorecard: forward returns, hit basis, pending exclusion."""
from __future__ import annotations

import datetime as dt

from vantage_server.rec_scorecard import build_scorecard, forward_return


def _bars(closes, start="2026-01-01"):
    d0 = dt.date.fromisoformat(start)
    return [{"date": (d0 + dt.timedelta(days=i)).isoformat(), "close": c}
            for i, c in enumerate(closes)]


def _day(date, *decisions):
    return {"date": date, "decisions": list(decisions)}


def _dec(sym, rec, rule):
    return {"symbol": sym, "recommendation": rec, "rule": rule}


def test_forward_return_basic_and_pending():
    bars = _bars([100, 101, 102, 103, 104, 105, 106])
    assert abs(forward_return(bars, "2026-01-01", 5) - 0.05) < 1e-9
    assert forward_return(bars, "2026-01-05", 5) is None  # horizon not elapsed
    assert forward_return(bars, "2030-01-01", 5) is None  # date beyond series


def test_bearish_hit_when_price_kept_falling():
    # price falls after a CLOSE call -> hit; rises after -> miss
    falling = _bars([100] + [100 - i for i in range(1, 30)])
    rising = _bars([100] + [100 + i for i in range(1, 30)])
    days = [
        _day("2026-01-01", _dec("AAA", "CLOSE_AND_BOOK_LOSS", "rule2_freefall_close")),
        _day("2026-01-01", _dec("BBB", "CLOSE_AND_BOOK_LOSS", "rule2_freefall_close")),
    ]
    out = build_scorecard(days, {"AAA": falling, "BBB": rising})
    rule = out["rules"][0]
    assert rule["rule"] == "rule2_freefall_close"
    assert rule["n_scored"] == 2 and rule["n_calls"] == 2
    assert rule["hit_rate"] == 0.5
    assert out["n_pending"] == 0


def test_constructive_hit_when_price_held_up():
    rising = _bars([100] + [100 + i for i in range(1, 30)])
    out = build_scorecard(
        [_day("2026-01-01", _dec("AAA", "HOLD_AND_SELL_CALL", "rule1_strong_at_support"))],
        {"AAA": rising})
    assert out["rules"][0]["hit_rate"] == 1.0


def test_monitor_scored_but_excluded_from_hit_rate():
    rising = _bars([100] + [100 + i for i in range(1, 30)])
    out = build_scorecard(
        [_day("2026-01-01", _dec("AAA", "MONITOR", "rule3_monitor"))],
        {"AAA": rising})
    rule = out["rules"][0]
    assert rule["n_scored"] == 1
    assert rule["n_calls"] == 0 and rule["hit_rate"] is None
    assert rule["avg_fwd_20d"] > 0


def test_too_recent_decisions_are_pending_not_scored():
    short = _bars([100, 101, 102])  # not enough future bars for +20d
    out = build_scorecard(
        [_day("2026-01-01", _dec("AAA", "CLOSE_AND_BOOK_LOSS", "r"))],
        {"AAA": short})
    assert out["rules"] == []
    assert out["n_pending"] == 1


def test_hit_basis_is_pinned_in_payload():
    out = build_scorecard([], {})
    assert "CLOSE_*" in out["hit_basis"] and "MONITOR excluded" in out["hit_basis"]
