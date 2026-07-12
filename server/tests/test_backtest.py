"""Locks the backtest harness's fill-simulation rules — the measurement
instrument for the strategy experiment loop. If these rules drift, every
experiment's numbers silently change meaning."""
import pandas as pd
import pytest

from vantage_server.backtest import simulate_fill


def _bars(rows):
    """rows: [(open, high, low, close)] -> a minimal 15m frame."""
    idx = pd.date_range("2026-01-05 09:30", periods=len(rows), freq="15min",
                        tz="America/New_York")
    return pd.DataFrame(
        {"Open": [r[0] for r in rows], "High": [r[1] for r in rows],
         "Low": [r[2] for r in rows], "Close": [r[3] for r in rows],
         "Volume": [1.0] * len(rows)}, index=idx)


def _ticket(side="long", entry=100.0, target=102.0, stop=99.0):
    return {"side": side, "spy_entry": entry, "spy_target": target, "spy_stop": stop}


def test_long_fills_then_hits_target():
    bars = _bars([(101, 101.5, 100.0, 100.5),   # dips to entry, stop untouched
                  (100.5, 102.5, 100.2, 102.0)])  # target touched
    res = simulate_fill(_ticket(), bars)
    assert res["reason"] == "target" and res["pnl_pct"] == pytest.approx(2.0)


def test_same_bar_entry_and_stop_is_a_stop_out():
    # conservative rule: the fill bar also touches the stop -> stop wins
    bars = _bars([(101, 101.5, 98.5, 99.5), (99.5, 103.0, 99.4, 102.9)])
    res = simulate_fill(_ticket(), bars)
    assert res["reason"] == "stop" and res["pnl_pct"] == pytest.approx(-1.0)


def test_target_never_credited_on_the_fill_bar():
    # one giant bar spans entry AND target but not stop -> ride to EOD close
    bars = _bars([(101, 103.0, 100.0, 101.5)])
    res = simulate_fill(_ticket(), bars)
    assert res["reason"] == "eod" and res["pnl_pct"] == pytest.approx(1.5)


def test_ambiguous_later_bar_counts_the_stop_first():
    bars = _bars([(101, 101.2, 100.0, 100.8),     # fill, no stop
                  (100.8, 102.5, 98.5, 101.0)])   # touches BOTH -> stop
    res = simulate_fill(_ticket(), bars)
    assert res["reason"] == "stop"


def test_short_fill_and_target():
    bars = _bars([(99, 100.2, 98.8, 99.5),        # rallies to entry (short at 100)
                  (99.5, 99.8, 97.5, 97.8)])      # falls to target 98
    res = simulate_fill(_ticket("short", 100.0, 98.0, 101.0), bars)
    assert res["reason"] == "target" and res["pnl_pct"] == pytest.approx(2.0)


def test_never_filled_returns_none():
    bars = _bars([(103, 104, 102.5, 103.5), (103.5, 105, 103.2, 104.8)])
    assert simulate_fill(_ticket(), bars) is None


def test_unfilled_ticket_missing_target_is_skipped():
    bars = _bars([(101, 101.5, 99.9, 100.5)])
    assert simulate_fill(_ticket(target=None), bars) is None


def test_eod_mark_to_close():
    bars = _bars([(101, 101.2, 100.0, 100.8),     # fill at 100
                  (100.8, 101.5, 100.5, 101.2)])  # neither side hit -> close
    res = simulate_fill(_ticket(), bars)
    assert res["reason"] == "eod" and res["pnl_pct"] == pytest.approx(1.2)


def test_break_ticket_starts_mid_session():
    # start_idx=1: the touch on bar 0 must NOT fill it
    bars = _bars([(101, 101.5, 99.5, 100.5),      # would fill if active
                  (100.5, 101.0, 100.4, 100.9)])  # never reaches entry
    assert simulate_fill(_ticket(), bars, start_idx=1) is None
