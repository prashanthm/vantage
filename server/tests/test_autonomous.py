"""The autonomous driver (autonomous.py, ADR-015 T2.7) + its API routes. The
driver dry-runs end-to-end with no env gates (recording audit, opening nothing),
a cap breach pauses the strategy, and the /api/lifecycle routes are gated the
same way. Fully offline — no network, no Alpaca creds, no real money."""
from __future__ import annotations

from pathlib import Path

import pytest

from vantage_server import autonomous, lifecycle
from vantage_server.store import Store, _SqliteBackend

NOW = "2026-07-19T13:00:00"


@pytest.fixture
def store(tmp_path):
    s = Store(str(tmp_path))
    s._backend = _SqliteBackend(tmp_path, tmp_path / "vantage.db")
    return s


@pytest.fixture
def live_reclaim(store, monkeypatch):
    """Promote reclaim to live with caps; stub the gate + order recompute so no
    playbook scaffold is needed."""
    monkeypatch.setattr(lifecycle, "paper_win_rate", lambda s, sid: (0.7, 40))
    monkeypatch.setattr(lifecycle, "backtest_baseline", lambda sid, cache_path=None: 0.6)
    lifecycle.promote(store, "reclaim", account="ALPACA-PAPER",
                      caps={"max_order_usd": 5000, "max_positions": 5}, now_iso=NOW)
    return store


def _one_order(usd=4500.0, qty=10):
    return lambda s, sid: [{"symbol": "SPY", "side": "buy", "qty": qty, "type": "limit",
                            "limit_price": usd / qty, "est_usd": usd, "ticket_key": "k"}]


def test_tick_dry_runs_with_no_env(live_reclaim, monkeypatch):
    monkeypatch.setattr(autonomous, "_orders_for", _one_order())
    out = autonomous.tick(live_reclaim, NOW, live=False)
    r = out["strategies"][0]
    assert r["strategy_id"] == "reclaim" and r.get("dry_run") == 1
    audit = live_reclaim.load_audit("reclaim")
    assert audit[0]["mode"] == "dry_run"          # recorded, opened nothing


def test_only_live_strategies_are_driven(store, monkeypatch):
    # reclaim left in 'paper' (not promoted) → the driver acts for no one.
    monkeypatch.setattr(autonomous, "_orders_for", _one_order())
    out = autonomous.tick(store, NOW, live=False)
    assert out["strategies"] == []


def test_cap_breach_pauses_the_strategy(live_reclaim, monkeypatch):
    monkeypatch.setenv("VANTAGE_LIVE_OK", "1")
    monkeypatch.setenv("VANTAGE_AUTONOMOUS_OK", "1")
    # an order over the $5000 cap, with env armed → CapBreach → pause.
    monkeypatch.setattr(autonomous, "_orders_for", _one_order(usd=45000, qty=100))
    autonomous.tick(live_reclaim, NOW, live=True)
    assert lifecycle._row(live_reclaim, "reclaim")["stage"] == "paused"
    assert any(a["mode"] == "cap_breach" for a in live_reclaim.load_audit("reclaim"))
    # a paused strategy is no longer driven.
    out = autonomous.tick(live_reclaim, NOW, live=True)
    assert out["strategies"] == []


def test_daily_loss_cap_fires_on_real_day_pnl(store, monkeypatch):
    """The max_daily_loss_usd cap pauses the strategy once the LIVE day P&L
    (from _live_context) is red past the limit — the piece that needed the broker
    fill feed. Stub _live_context to a −$1200 day with a within-size order."""
    monkeypatch.setattr(lifecycle, "paper_win_rate", lambda s, sid: (0.7, 40))
    monkeypatch.setattr(lifecycle, "backtest_baseline", lambda sid, cache_path=None: 0.6)
    lifecycle.promote(store, "reclaim", account="ALPACA-PAPER",
                      caps={"max_order_usd": 5000, "max_daily_loss_usd": 1000}, now_iso=NOW)
    monkeypatch.setenv("VANTAGE_LIVE_OK", "1")
    monkeypatch.setenv("VANTAGE_AUTONOMOUS_OK", "1")
    monkeypatch.setattr(autonomous, "_orders_for", _one_order(usd=4500))   # within size cap
    # real broker day P&L is −$1200, past the $1000 daily-loss cap.
    monkeypatch.setattr(autonomous, "_live_context",
                        lambda s, sid: {"open_positions": 1, "day_pnl": -1200.0})
    autonomous.tick(store, NOW, live=True)
    assert lifecycle._row(store, "reclaim")["stage"] == "paused"
    # the pause reason names the daily-loss cap; the audit row records the cap+limit.
    assert "max_daily_loss_usd" in lifecycle._row(store, "reclaim")["paused_reason"]


# ── API routes ────────────────────────────────────────────────────────────────
# The shared fixtures data dir is JSON-backed (no SQLite), so lifecycle routes
# return the honest available:False state — the SQLite-backed behavior is covered
# by the driver + lifecycle unit tests above. Here we prove the routes are wired,
# reachable, and degrade cleanly (never crash, never place an order).

@pytest.fixture
def api_client():
    from fastapi.testclient import TestClient

    from vantage_server.api import create_app
    return TestClient(create_app(Path(__file__).resolve().parent / "fixtures"))


def test_strategies_routes_are_wired_and_degrade_on_json_backend(api_client):
    r = api_client.get("/api/lifecycle")
    assert r.status_code == 200                     # reachable
    assert r.json()["available"] is False           # JSON backend → honest empty

    # tick is reachable + dry-run safe even without SQLite.
    t = api_client.post("/api/lifecycle/tick", json={"live": True})
    assert t.status_code == 200 and t.json()["available"] is False

    # audit route reachable.
    a = api_client.get("/api/lifecycle/reclaim/audit")
    assert a.status_code == 200


def test_promote_route_reachable(api_client):
    # POST reaches the route (not a 405), and on the JSON backend the lifecycle
    # write no-ops → refused, never a crash / never an order.
    r = api_client.post("/api/lifecycle/reclaim/promote",
                        json={"account": "ALPACA-PAPER", "caps": {"max_order_usd": 5000}})
    assert r.status_code == 200
    assert r.json()["available"] is False
