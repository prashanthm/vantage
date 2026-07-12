"""Risk/reward geometry: ratio math, degenerate statuses, nullability."""
from __future__ import annotations

from vantage_server.risk_reward import risk_reward


def _plan(target=180.0, stop=95.0, **over):
    base = {"symbol": "PLTR", "thesis": "t", "target": target, "stop": stop,
            "notes": None, "updated_at": "2026-07-11"}
    base.update(over)
    return base


def test_basic_geometry():
    out = risk_reward(_plan(), 126.79)
    assert out["status"] == "ok"
    assert out["upside"] == 53.21
    assert out["downside"] == 31.79
    assert out["rr_ratio"] == 1.67
    assert out["upside_pct"] == 42.0
    assert out["downside_pct"] == 25.1


def test_no_plan_is_none():
    assert risk_reward(None, 100.0) is None


def test_incomplete_plan_reports_status_not_guesses():
    out = risk_reward(_plan(stop=None), 126.79)
    assert out["status"] == "incomplete_plan"
    assert out["rr_ratio"] is None and out["upside"] is None


def test_stop_breached_and_target_reached():
    assert risk_reward(_plan(), 90.0)["status"] == "stop_breached"
    assert risk_reward(_plan(), 200.0)["status"] == "target_reached"


def test_no_downside_room_leaves_ratio_undefined():
    out = risk_reward(_plan(stop=130.0), 126.79)  # stop above price
    assert out["status"] == "stop_breached"
    assert out["rr_ratio"] is None


def test_missing_price_is_incomplete():
    assert risk_reward(_plan(), None)["status"] == "incomplete_plan"
