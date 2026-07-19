"""The ADR-015 autonomous carve-out: allowlist refusal on BOTH the read and the
order dispatcher, dry-run-by-default, the four gates (kill switch + double env,
per-strategy caps, manual/eligible promotion, audit log), reduce-only exits, and
multi-leg options body mapping. Fully offline and deterministic — no network, no
alpaca dependency, no credentials."""
from __future__ import annotations

import pytest

from vantage_server.brokers import alpaca_broker as ab
from vantage_server.brokers import alpaca_execution as ax
from vantage_server.brokers.base import ReadOnlyViolation


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, tmp_path):
    """Every test starts with all gates UNARMED and the kill switch absent."""
    for k in ("VANTAGE_LIVE_OK", "VANTAGE_AUTONOMOUS_OK",
              "ALPACA_API_KEY", "ALPACA_SECRET_KEY", "ALPACA_PAPER"):
        monkeypatch.delenv(k, raising=False)
    # point the kill switch at a path that does not exist (clean by default)
    monkeypatch.setattr(ax, "KILL_SWITCH_FILE", str(tmp_path / "no-kill"))


ORDER = {"symbol": "SPY", "side": "buy", "qty": 10, "type": "market", "est_usd": 4500}


# ── read dispatcher stays read-only (never reaches an order path) ──────────────

def test_read_dispatcher_refuses_order_paths():
    for bad in ("/v2/orders", "/v2/orders/1", "/v2/account/configurations"):
        with pytest.raises(ReadOnlyViolation):
            ab._get(bad)


def test_read_module_is_a_connection_but_execution_is_not():
    from vantage_server.brokers import CONNECTIONS
    assert "alpaca" in CONNECTIONS                       # read connection registered
    assert all("execution" not in c.__module__ for c in CONNECTIONS.values())


# ── order dispatcher allowlist (refuse before I/O) ────────────────────────────

def test_order_dispatcher_refuses_non_allowlisted_op():
    with pytest.raises(ax.ExecutionViolation):
        ax._order_call("POST /v2/account", {})
    with pytest.raises(ax.ExecutionViolation):
        ax._order_call("GET /v2/positions", {})


# ── dry-run is the default; live requires the gates ───────────────────────────

def test_dry_run_when_live_not_requested():
    log = []
    r = ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={}, context={}, audit=log.append)
    assert r["mode"] == "dry_run"
    assert log[-1]["mode"] == "dry_run"


def test_gate3_non_eligible_strategy_refused_live():
    log = []
    with pytest.raises(ax.ExecutionViolation):
        ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=False,
                                 caps={}, context={}, audit=log.append, live=True)
    assert log[-1]["mode"] == "refused"


def test_gate1_unarmed_env_degrades_to_dry_run(monkeypatch):
    # only ONE env set → still unarmed → safe dry-run, not a live submit.
    monkeypatch.setenv("VANTAGE_LIVE_OK", "1")   # autonomous env still missing
    log = []
    r = ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={}, context={}, audit=log.append, live=True)
    assert r["mode"] == "dry_run" and "gate not armed" in log[-1]["reason"]


def test_kill_switch_forces_dry_run(monkeypatch, tmp_path):
    monkeypatch.setenv("VANTAGE_LIVE_OK", "1")
    monkeypatch.setenv("VANTAGE_AUTONOMOUS_OK", "1")
    kill = tmp_path / "KILL"
    kill.write_text("halt")
    monkeypatch.setattr(ax, "KILL_SWITCH_FILE", str(kill))
    assert ax.kill_switch_engaged() is True
    assert ax.autonomous_allowed() is False
    log = []
    r = ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={}, context={}, audit=log.append, live=True)
    assert r["mode"] == "dry_run"


# ── gate 2: per-strategy caps (checked before a live submit) ──────────────────

@pytest.fixture
def _armed(monkeypatch, tmp_path):
    monkeypatch.setenv("VANTAGE_LIVE_OK", "1")
    monkeypatch.setenv("VANTAGE_AUTONOMOUS_OK", "1")
    monkeypatch.setattr(ax, "KILL_SWITCH_FILE", str(tmp_path / "no-kill"))
    assert ax.autonomous_allowed() is True


def test_cap_max_order_usd(_armed):
    log = []
    with pytest.raises(ax.CapBreach) as e:
        ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={"max_order_usd": 1000}, context={},
                                 audit=log.append, live=True)
    assert e.value.cap == "max_order_usd" and log[-1]["mode"] == "cap_breach"


def test_cap_max_positions(_armed):
    with pytest.raises(ax.CapBreach) as e:
        ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={"max_positions": 3},
                                 context={"open_positions": 3}, audit=lambda r: None, live=True)
    assert e.value.cap == "max_positions"


def test_cap_daily_loss(_armed):
    with pytest.raises(ax.CapBreach) as e:
        ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={"max_daily_loss_usd": 500},
                                 context={"day_pnl": -600}, audit=lambda r: None, live=True)
    assert e.value.cap == "max_daily_loss_usd"


def test_caps_within_limits_would_submit_but_no_creds(_armed):
    # all gates pass, caps OK → reaches the submit, which fails on missing creds
    # (never a silent success). Proves the path is otherwise clear.
    # BrokerConnectionError is the base of AlpacaExecutionError — _creds() raises
    # the base before the _order_call try-wrap, so accept either.
    from vantage_server.brokers.base import BrokerConnectionError
    with pytest.raises(BrokerConnectionError):
        ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                                 caps={"max_order_usd": 10000, "max_positions": 5},
                                 context={"open_positions": 0, "day_pnl": 0},
                                 audit=lambda r: None, live=True)


# ── reduce-only exits + multi-leg body ────────────────────────────────────────

def test_exit_is_reduce_only_and_side_derived():
    log = []
    ex = ax.place_exit("long", "SPY", 10, strategy="reclaim", audit=log.append)
    assert ex["order"]["side"] == "sell"          # long → sell to close
    assert ex["order"]["reduce_only"] is True
    assert ex["order"]["time_in_force"] == "gtc"
    ex2 = ax.place_exit("short", "SPY", 5, strategy="reclaim", audit=log.append)
    assert ex2["order"]["side"] == "buy"          # short → buy to cover


def test_multileg_maps_to_mleg_order_class():
    body = ax._alpaca_body({
        "side": "buy", "qty": 1, "type": "limit", "limit_price": 1.2,
        "legs": [{"symbol": "SPY260117C500", "side": "buy"},
                 {"symbol": "SPY260117C510", "side": "sell"}],
    })
    assert body["order_class"] == "mleg"
    assert len(body["legs"]) == 2
    assert "symbol" not in body                    # multi-leg has no top-level symbol


def test_audit_is_called_for_every_outcome():
    log = []
    ax.submit_strategy_order(ORDER, strategy="reclaim", live_eligible=True,
                             caps={}, context={}, audit=log.append)  # dry_run
    assert len(log) == 1 and log[0]["strategy"] == "reclaim"
