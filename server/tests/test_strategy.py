"""Strategy registry (strategy.py): registration, lookup, the reclaim impl's
delegation to reclaim_strategy (the SSOT), and the champion-params drift guard.
Fully offline."""
from __future__ import annotations

import pytest

from vantage_server import reclaim_strategy as rs
from vantage_server.strategy import STRATEGIES, ReclaimStrategy, get_strategy


def test_reclaim_is_registered():
    assert "reclaim" in STRATEGIES
    assert isinstance(get_strategy("reclaim"), ReclaimStrategy)
    assert get_strategy("reclaim").strategy_id == "reclaim"


def test_unknown_strategy_raises_valueerror():
    with pytest.raises(ValueError):
        get_strategy("does-not-exist")


def test_edge_guard_delegates_to_ssot():
    s = get_strategy("reclaim")
    # same verdicts as reclaim_strategy.is_worth_taking
    assert s.is_worth_taking(100.0, 99.8, 101.0, "long")[0] is True
    ok, why = s.is_worth_taking(100.0, 99.8, 99.5, "long")   # target wrong side
    assert ok is False and "wrong side" in why
    # matches the SSOT exactly
    assert s.is_worth_taking(100.0, 99.8, 101.0, "long") == \
        rs.is_worth_taking(100.0, 99.8, 101.0, "long")


def test_champion_params_track_the_ssot_constants():
    p = get_strategy("reclaim").champion_params()
    assert p["rr_min"] == rs.MIN_REWARD_RISK          # drift guard: 1.5
    assert p["confirm_closes"] == rs.RECLAIM_CLOSES    # 3
    assert p["stop_pad_pct"] == rs.STOP_PAD_PCT        # 0.20
    assert p["suppress_counter_trend"] is True


def test_universe_is_coach_snapshot_symbols():
    assert set(get_strategy("reclaim").universe) >= {"SPX", "SPY", "QQQ", "IWM"}
