"""The ADR-010 v2 execution carve-out: allowlist refusal on BOTH dispatchers,
dry-run-by-default, the VANTAGE_LIVE_OK env gate, ticket→legs mapping, the
never-abort bracket discipline, and the /api/ticket/execute route. Fully
offline and deterministic — no network, no mcp dependency, no token file."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from vantage_server import order_ticket
from vantage_server.api import create_app
from vantage_server.brokers import robinhood_execution as rexec
from vantage_server.brokers.robinhood import READ_TOOLS, ReadOnlyViolation, _call
from vantage_server.brokers.robinhood_execution import (
    EXECUTE_TOOLS,
    ExecutionViolation,
    _call_execute,
    execute_ticket,
)


def _ticket(side: str = "long", *, risk: float = 100.0) -> dict:
    """A real staged ticket through the real geometry (entry 100, pad 0.20% →
    stop 99.8, one resistance target at 101)."""
    return order_ticket.build_ticket(
        "SPY", side, 100.0,
        supports=[99.0], resistances=[101.0], risk_amount=risk,
    )


# ------------------------------------------------ allowlists stay disjoint

@pytest.mark.parametrize("tool", [
    "get_portfolio",            # read tools are NOT order tools
    "get_equity_positions",
    "place_option_order",       # options never allowed
    "transfer_funds",
    "add_option_to_watchlist",
    "",
])
def test_execute_dispatcher_refuses_tools_outside_allowlist(tool):
    with pytest.raises(ExecutionViolation, match="ADR-010"):
        _call_execute(tool, {"account_number": "X"})


def test_execute_allowlist_is_exactly_the_three_order_tools():
    assert EXECUTE_TOOLS == frozenset({
        "review_equity_order", "place_equity_order", "cancel_equity_order",
    })


def test_allowlists_are_disjoint_and_read_path_still_refuses_orders():
    assert not (EXECUTE_TOOLS & READ_TOOLS)
    for tool in EXECUTE_TOOLS:
        with pytest.raises(ReadOnlyViolation, match="ADR-010"):
            _call(tool, {"account_number": "X"})


def test_refusal_happens_before_any_network_or_mcp_import(monkeypatch):
    """The allowlist check must precede the robinhood-module import and any
    transport work — the refusal path needs neither credentials nor mcp."""
    import vantage_server.brokers.robinhood as rh

    def boom(*a, **k):  # pragma: no cover - must never run
        raise AssertionError("network path reached on a refused tool")

    monkeypatch.setattr(rh, "_acall", boom)
    with pytest.raises(ExecutionViolation):
        _call_execute("get_portfolio", {})


# ------------------------------------------------ dry-run default + env gate

def test_execute_ticket_dry_run_by_default(monkeypatch):
    """live omitted → every leg is a dry_run stub; no tool is ever invoked."""
    def boom(*a, **k):  # pragma: no cover
        raise AssertionError("dry run must not touch the network")
    monkeypatch.setattr(rexec, "_call_execute", boom)

    result = execute_ticket(_ticket("long"), "ACCT1")
    assert result["mode"] == "dry_run"
    assert result["ok"] is True
    names = [leg["leg"] for leg in result["legs"]]
    assert names[0] == "entry" and names[1] == "stop" and names[2].startswith("T")
    assert all(leg["status"] == "dry_run" for leg in result["legs"])
    assert all(leg["order_id"].startswith("dry_") for leg in result["legs"])


def test_live_without_env_gate_is_refused(monkeypatch):
    monkeypatch.delenv(rexec.LIVE_ENV, raising=False)
    with pytest.raises(ExecutionViolation, match="VANTAGE_LIVE_OK"):
        execute_ticket(_ticket("long"), "ACCT1", live=True)


def test_live_with_env_gate_places_orders(monkeypatch):
    monkeypatch.setenv(rexec.LIVE_ENV, "1")
    calls: list[tuple[str, dict]] = []

    def fake_call(tool, payload, max_retries=3):
        calls.append((tool, payload))
        return {"id": f"ord_{len(calls)}", "state": "confirmed"}

    monkeypatch.setattr(rexec, "_call_execute", fake_call)
    result = execute_ticket(_ticket("long"), "ACCT1", live=True)

    assert result["mode"] == "live"
    assert result["ok"] is True
    # entry is reviewed before it is placed (sentinel's discipline)
    assert calls[0][0] == "review_equity_order"
    assert calls[1][0] == "place_equity_order"
    assert calls[1][1]["side"] == "buy" and calls[1][1]["type"] == "limit"
    # stop + targets are placed, sell-side for a long
    stop_call = calls[2][1]
    assert calls[2][0] == "place_equity_order"
    assert stop_call["type"] == "stop_market" and stop_call["side"] == "sell"
    assert all(t == "place_equity_order" for t, _ in calls[3:])
    # every placement carried a ref_id (idempotency handle)
    assert all(p.get("ref_id") for t, p in calls if t == "place_equity_order")


# ------------------------------------------------ ticket validation + brackets

def test_unsized_ticket_is_refused():
    ticket = _ticket("long", risk=0.01)   # can't afford one share
    assert not ticket["sized"]
    with pytest.raises(ValueError, match="unsized"):
        execute_ticket(ticket, "ACCT1")


def test_missing_account_is_refused():
    with pytest.raises(ValueError, match="account_number"):
        execute_ticket(_ticket("long"), "")


def test_arbitrary_dict_is_not_a_ticket():
    with pytest.raises(ValueError, match="reclaim ticket"):
        execute_ticket({"symbol": "SPY", "side": "long",
                        "orders": {"entry": "buy 5"}}, "ACCT1")


def test_failed_entry_skips_bracket_legs(monkeypatch):
    """No naked stops/targets: if the entry is rejected, nothing else is
    placed and the failure is reported."""
    monkeypatch.setenv(rexec.LIVE_ENV, "1")
    calls: list[str] = []

    def fake_call(tool, payload, max_retries=3):
        calls.append(tool)
        if tool == "place_equity_order":
            return {"state": "rejected", "reject_reason": "no buying power"}
        return {}

    monkeypatch.setattr(rexec, "_call_execute", fake_call)
    result = execute_ticket(_ticket("long"), "ACCT1", live=True)
    assert result["ok"] is False
    assert calls == ["review_equity_order", "place_equity_order"]
    assert any("brackets skipped" in w for w in result["warnings"])


def test_failed_bracket_leg_never_aborts(monkeypatch):
    """Sentinel's discipline: a filled entry with a failing stop leg is
    surfaced as a warning, and the remaining legs still go out."""
    monkeypatch.setenv(rexec.LIVE_ENV, "1")
    calls: list[tuple[str, dict]] = []

    def fake_call(tool, payload, max_retries=3):
        calls.append((tool, payload))
        if payload.get("type") == "stop_market":
            raise rexec.RobinhoodExecutionError("settlement pending")
        return {"id": f"ord_{len(calls)}", "state": "confirmed"}

    monkeypatch.setattr(rexec, "_call_execute", fake_call)
    result = execute_ticket(_ticket("long"), "ACCT1", live=True)
    assert any("stop" in w for w in result["warnings"])
    # targets were still placed after the stop failure
    assert any(p.get("time_in_force") == "gtc" for _, p in calls)


def test_short_ticket_sides_are_mirrored(monkeypatch):
    result = execute_ticket(_ticket("short"), "ACCT1")   # dry run
    entry = next(leg for leg in result["legs"] if leg["leg"] == "entry")
    stop = next(leg for leg in result["legs"] if leg["leg"] == "stop")
    assert entry["side"] == "sell" and stop["side"] == "buy"


# ------------------------------------------------ the API route

@pytest.fixture()
def client(data_dir):
    return TestClient(create_app(data_dir))


def test_execute_route_dry_runs_by_default(client, monkeypatch):
    monkeypatch.delenv(rexec.LIVE_ENV, raising=False)
    r = client.post("/api/ticket/execute", json={
        "symbol": "SPY", "side": "long", "level": 100.0, "risk": 100.0,
        "account_number": "ACCT1",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["execution"]["mode"] == "dry_run"
    assert all(leg["status"] == "dry_run" for leg in body["execution"]["legs"])
    # the ticket in the response is the server-recomputed one
    assert body["ticket"]["symbol"] == "SPY"


def test_execute_route_refuses_live_without_gate(client, monkeypatch):
    monkeypatch.delenv(rexec.LIVE_ENV, raising=False)
    r = client.post("/api/ticket/execute", json={
        "symbol": "SPY", "side": "long", "level": 100.0,
        "account_number": "ACCT1", "live": True,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert "VANTAGE_LIVE_OK" in body["note"]


def test_execute_route_rejects_bad_params(client):
    r = client.post("/api/ticket/execute", json={
        "symbol": "SPY", "side": "sideways", "level": 100.0,
        "account_number": "ACCT1",
    })
    assert r.json()["available"] is False


def test_execute_route_ignores_client_supplied_ticket(client, monkeypatch):
    """A client-supplied ticket/orders body key changes nothing — the server
    recomputes the ticket from symbol/side/level/risk (the structural
    strategy-only guarantee)."""
    monkeypatch.delenv(rexec.LIVE_ENV, raising=False)
    r = client.post("/api/ticket/execute", json={
        "symbol": "SPY", "side": "long", "level": 100.0, "risk": 100.0,
        "account_number": "ACCT1",
        "ticket": {"orders": {"entry": {"price": 1.0, "qty": 999999}}},
    })
    body = r.json()
    assert body["available"] is True
    assert body["ticket"]["orders"]["entry"]["qty"] != 999999
    assert body["ticket"]["orders"]["entry"]["price"] == 100.0
