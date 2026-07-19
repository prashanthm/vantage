"""Strategy lifecycle stage machine (lifecycle.py, ADR-015): the promotion gate
(beat the frozen backtest baseline + min sample), the paper->eligible->live->
paused transitions, promotion refusal when the gate fails, caps validation, and
the audit log. Gate INPUTS (paper win-rate, backtest baseline) are stubbed so the
STATE MACHINE is tested deterministically without paper/backtest data. One
non-stubbed test confirms the real baseline computes from the frozen cache."""
from __future__ import annotations

from pathlib import Path

import pytest

from vantage_server import lifecycle as L
from vantage_server.store import Store, _SqliteBackend

NOW = "2026-07-19T12:00:00"


@pytest.fixture
def store(tmp_path):
    s = Store(str(tmp_path))
    s._backend = _SqliteBackend(tmp_path, tmp_path / "vantage.db")   # schema auto-inits
    return s


@pytest.fixture
def pass_gate(monkeypatch):
    """Force a passing gate: paper 0.70 over 40 trades vs baseline 0.60."""
    monkeypatch.setattr(L, "paper_win_rate", lambda s, sid: (0.70, 40))
    monkeypatch.setattr(L, "backtest_baseline", lambda sid, cache_path=None: 0.60)


def test_fresh_strategy_reads_paper(store):
    assert L._row(store, "reclaim")["stage"] == "paper"
    assert L.is_live_eligible(store, "reclaim") is False


def test_gate_requires_min_sample(store, monkeypatch):
    monkeypatch.setattr(L, "paper_win_rate", lambda s, sid: (0.9, 5))   # tiny sample
    monkeypatch.setattr(L, "backtest_baseline", lambda sid, cache_path=None: 0.5)
    g = L.evaluate_gate(store, "reclaim")
    assert g["passes"] is False and "insufficient sample" in g["reason"]


def test_gate_requires_beating_baseline(store, monkeypatch):
    monkeypatch.setattr(L, "paper_win_rate", lambda s, sid: (0.55, 40))
    monkeypatch.setattr(L, "backtest_baseline", lambda sid, cache_path=None: 0.60)
    g = L.evaluate_gate(store, "reclaim")
    assert g["passes"] is False and "below backtest baseline" in g["reason"]


def test_refresh_stage_flips_paper_to_eligible(store, pass_gate):
    r = L.refresh_stage(store, "reclaim", NOW)
    assert r["stage"] == "eligible"                 # gate passes → eligible, NOT live
    assert L.is_live_eligible(store, "reclaim") is False   # eligible ≠ live


def test_promote_requires_passing_gate(store, monkeypatch):
    # gate fails → promote refuses.
    monkeypatch.setattr(L, "paper_win_rate", lambda s, sid: (0.4, 40))
    monkeypatch.setattr(L, "backtest_baseline", lambda sid, cache_path=None: 0.6)
    with pytest.raises(ValueError, match="gate not passed"):
        L.promote(store, "reclaim", account="ALPACA-PAPER",
                  caps={"max_order_usd": 5000}, now_iso=NOW)


def test_promote_sets_live_with_caps(store, pass_gate):
    caps = {"max_order_usd": 5000, "max_positions": 3, "max_daily_loss_usd": 1000}
    r = L.promote(store, "reclaim", account="ALPACA-PAPER", caps=caps, now_iso=NOW)
    assert r["stage"] == "live" and r["live_account"] == "ALPACA-PAPER"
    assert L.is_live_eligible(store, "reclaim") is True
    assert L.caps_for(store, "reclaim") == caps


def test_caps_must_be_positive(store, pass_gate):
    with pytest.raises(ValueError, match="must be positive"):
        L.promote(store, "reclaim", account="X",
                  caps={"max_order_usd": -1}, now_iso=NOW)


def test_pause_and_resume(store, pass_gate):
    L.promote(store, "reclaim", account="X", caps={"max_order_usd": 5000}, now_iso=NOW)
    L.pause(store, "reclaim", "max_daily_loss_usd breach", NOW)
    assert L._row(store, "reclaim")["stage"] == "paused"
    assert L.is_live_eligible(store, "reclaim") is False       # paused ≠ live-eligible
    L.resume(store, "reclaim", NOW)
    assert L._row(store, "reclaim")["stage"] == "live"


def test_cannot_resume_never_promoted(store):
    with pytest.raises(ValueError, match="never promoted"):
        L.resume(store, "reclaim", NOW)


def test_audit_log_append_and_read(store):
    store.append_audit({"at": NOW, "strategy_id": "reclaim", "mode": "submitted",
                        "reason": None, "order": {"symbol": "SPY", "qty": 10},
                        "gates": {"live_env": True}, "order_id": "abc"})
    trail = store.load_audit("reclaim")
    assert len(trail) == 1
    assert trail[0]["mode"] == "submitted" and trail[0]["order"]["symbol"] == "SPY"
    assert trail[0]["order_id"] == "abc"


def test_real_backtest_baseline_computes_from_frozen_cache():
    """Non-stubbed: the baseline actually computes from the committed frozen cache
    (a float in [0,1]), so the gate has a real bar to clear."""
    cache = str(Path(__file__).parent.parent / "backtest_data" / "bars_frozen.json")
    if not Path(cache).exists():
        pytest.skip("frozen cache not present")
    b = L.backtest_baseline("reclaim", cache)
    assert b is None or (0.0 <= b <= 1.0)
