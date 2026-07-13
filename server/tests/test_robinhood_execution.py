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


class FakeStore:
    """Captures record_managed_position; mimics the SQLite accessor shape."""

    uses_sqlite = True

    def __init__(self):
        self.recorded: list[dict] = []

    def record_managed_position(self, row):
        self.recorded.append(row)
        return len(self.recorded)


def test_live_fill_places_gtc_stop_and_records_position(monkeypatch):
    """Live flow (no-OCO world): entry reviewed+placed → fill detected →
    protective stop rests GTC → managed row recorded ACTIVE. Targets are
    NEVER placed as resting orders — they belong to the monitor."""
    monkeypatch.setenv(rexec.LIVE_ENV, "1")
    monkeypatch.setattr("time.sleep", lambda s: None)
    calls: list[tuple[str, dict]] = []

    def fake_call(tool, payload, max_retries=3):
        calls.append((tool, payload))
        return {"id": f"ord_{len(calls)}", "state": "confirmed"}

    monkeypatch.setattr(rexec, "_call_execute", fake_call)
    monkeypatch.setattr(rexec, "order_status", lambda acct, oid: {
        "id": oid, "state": "filled", "average_price": "99.98",
        "cumulative_quantity": "500"})
    store = FakeStore()
    result = execute_ticket(_ticket("long"), "ACCT1", live=True, store=store)

    assert result["mode"] == "live" and result["ok"] is True
    # entry is reviewed before it is placed (sentinel's discipline)
    assert [t for t, _ in calls[:3]] == [
        "review_equity_order", "place_equity_order", "place_equity_order"]
    assert calls[1][1]["side"] == "buy" and calls[1][1]["type"] == "limit"
    stop_call = calls[2][1]
    assert stop_call["type"] == "stop_market" and stop_call["side"] == "sell"
    assert stop_call["time_in_force"] == "gtc"           # swing-safe stop
    assert len(calls) == 3                               # no resting targets
    assert all(p.get("ref_id") for t, p in calls if t == "place_equity_order")
    row = store.recorded[0]
    assert row["status"] == "active" and row["entry_price"] == 99.98
    assert row["stop_order_id"] and row["exit_policy"] == "ladder"
    assert result["managed_position_id"] == 1


def test_live_unfilled_entry_hands_off_to_monitor(monkeypatch):
    """A resting (swing) entry that doesn't fill in the wait window records
    a pending_entry row — the monitor places the stop on fill. No stop is
    placed while there is nothing to protect."""
    monkeypatch.setenv(rexec.LIVE_ENV, "1")
    monkeypatch.setattr("time.sleep", lambda s: None)
    calls: list[tuple[str, dict]] = []

    def fake_call(tool, payload, max_retries=3):
        calls.append((tool, payload))
        return {"id": f"ord_{len(calls)}", "state": "confirmed"}

    monkeypatch.setattr(rexec, "_call_execute", fake_call)
    monkeypatch.setattr(rexec, "order_status",
                        lambda acct, oid: {"id": oid, "state": "confirmed"})
    store = FakeStore()
    result = execute_ticket(_ticket("long"), "ACCT1", live=True, store=store,
                            fill_wait_sec=0.01)
    assert [t for t, _ in calls] == ["review_equity_order", "place_equity_order"]
    assert store.recorded[0]["status"] == "pending_entry"
    assert store.recorded[0]["stop_order_id"] is None
    assert any("monitor" in w for w in result["warnings"])


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


def test_failed_entry_places_nothing_else(monkeypatch):
    """No naked protection: if the entry is rejected, nothing else is
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
    assert any("nothing to protect" in w for w in result["warnings"])


def test_failed_stop_leg_never_aborts_and_row_records_gap(monkeypatch):
    """A filled entry with a failing stop leg is surfaced as a warning and
    the managed row records stop_order_id=None — the monitor's re-arm step
    owns the retry."""
    monkeypatch.setenv(rexec.LIVE_ENV, "1")
    monkeypatch.setattr("time.sleep", lambda s: None)

    def fake_call(tool, payload, max_retries=3):
        if payload.get("type") == "stop_market":
            raise rexec.RobinhoodExecutionError("settlement pending")
        return {"id": "ord_entry", "state": "confirmed"}

    monkeypatch.setattr(rexec, "_call_execute", fake_call)
    monkeypatch.setattr(rexec, "order_status", lambda acct, oid: {
        "id": oid, "state": "filled", "average_price": "100.0",
        "cumulative_quantity": "500"})
    store = FakeStore()
    result = execute_ticket(_ticket("long"), "ACCT1", live=True, store=store)
    assert any("stop" in w for w in result["warnings"])
    assert store.recorded[0]["status"] == "active"
    assert store.recorded[0]["stop_order_id"] is None


def test_place_exit_order_is_reduce_only():
    """The monitor's only order surface derives side from position side —
    an opening order is inexpressible through it."""
    r = rexec.place_exit_order("A", "SPY", "long", 5, order_type="limit",
                               limit_price=101.0, dry_run=True)
    assert r["side"] == "sell" and r["time_in_force"] == "gtc"
    r = rexec.place_exit_order("A", "SPY", "short", 5, order_type="stop_market",
                               stop_price=105.0, dry_run=True)
    assert r["side"] == "buy"
    with pytest.raises(ValueError, match="position_side"):
        rexec.place_exit_order("A", "SPY", "flat", 5, order_type="limit",
                               limit_price=1.0, dry_run=True)


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
