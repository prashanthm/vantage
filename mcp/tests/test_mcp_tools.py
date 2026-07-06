"""MCP tool surface tests: listing, read-only annotations, call round-trips
via the SDK's in-memory client transport, and the provenance block Mira
grounds on."""
from __future__ import annotations

import asyncio
import json

import pytest

from mcp.shared.memory import create_connected_server_and_client_session

from vantage_mcp.server import create_mcp

EXPECTED_TOOLS = {
    "vantage.positions",
    "vantage.allocation",
    "vantage.wash_status",
    "vantage.tlh_candidates",
    "vantage.lots",
    "vantage.quotes",
    "vantage.signals",
    "vantage.history",
    "vantage.strategies",
    "vantage.analysis",
    "vantage.position_actions",
}


@pytest.fixture(scope="module")
def mcp(data_dir):
    return create_mcp(data_dir)


def run_with_client(mcp, coro_fn):
    """Run an async client interaction against the server in-memory."""

    async def runner():
        async with create_connected_server_and_client_session(
            mcp._mcp_server
        ) as client:
            return await coro_fn(client)

    return asyncio.run(runner())


def tool_payload(result) -> dict:
    assert not result.isError, result.content
    if result.structuredContent:
        return result.structuredContent
    return json.loads(result.content[0].text)


def test_tool_listing_and_read_only_hints(mcp):
    async def interact(client):
        return await client.list_tools()

    listing = run_with_client(mcp, interact)
    by_name = {t.name: t for t in listing.tools}
    assert set(by_name) == EXPECTED_TOOLS
    for name, tool in by_name.items():
        assert tool.annotations is not None, f"{name} missing annotations"
        assert tool.annotations.readOnlyHint is True, f"{name} not read-only"
        assert tool.description


def test_flat_input_schemas(mcp):
    async def interact(client):
        return await client.list_tools()

    listing = run_with_client(mcp, interact)
    by_name = {t.name: t for t in listing.tools}
    pos_props = by_name["vantage.positions"].inputSchema.get("properties", {})
    assert "account" in pos_props
    tlh_props = by_name["vantage.tlh_candidates"].inputSchema.get("properties", {})
    assert {"threshold_usd", "threshold_pct"} <= set(tlh_props)
    # no required params anywhere — every tool is callable with {}
    for tool in listing.tools:
        assert not tool.inputSchema.get("required")


@pytest.mark.parametrize("name", sorted(EXPECTED_TOOLS))
def test_every_tool_result_has_provenance(mcp, name, data_dir):
    async def interact(client):
        return await client.call_tool(name, {})

    payload = tool_payload(run_with_client(mcp, interact))
    prov = payload["provenance"]
    assert prov["source_type"] == "vantage"
    dataset = name.split(".", 1)[1]
    assert prov["source_id"] == f"{data_dir}#{dataset}"
    assert payload["source"] == "fixture"
    assert payload["as_of"] == "2026-07-05T09:30:00-04:00"


def test_positions_round_trip(mcp):
    async def interact(client):
        return await client.call_tool("vantage.positions", {"account": "fid-taxable"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["account"] == "fid-taxable"
    total = sum(p["value"] for p in payload["positions"])
    assert total == pytest.approx(83_627.05)


def test_wash_status_single_symbol(mcp):
    async def interact(client):
        return await client.call_tool("vantage.wash_status", {"symbol": "VOO"})

    payload = tool_payload(run_with_client(mcp, interact))
    assert list(payload["wash"]) == ["VOO"]
    assert payload["wash"]["VOO"]["blocked"] is True
    assert payload["wash"]["VOO"]["clears_on_date"] == "2026-08-01"


def test_wash_status_all_held_symbols(mcp):
    async def interact(client):
        return await client.call_tool("vantage.wash_status", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert "CASH" not in payload["wash"]
    blocked = {s for s, w in payload["wash"].items() if w["blocked"]}
    assert blocked == {"VOO", "SPY", "QQQ", "VTI"}


def test_tlh_candidates_round_trip(mcp):
    async def interact(client):
        return await client.call_tool("vantage.tlh_candidates", {})

    payload = tool_payload(run_with_client(mcp, interact))
    rows = [(c["lot"]["symbol"], c["status"]) for c in payload["candidates"]]
    assert rows == [
        ("IWM", "clear"), ("BND", "na"), ("TSLA", "clear"),
        ("VOO", "blocked"), ("BND", "below"),
    ]


def test_quotes_round_trip(mcp):
    async def interact(client):
        return await client.call_tool("vantage.quotes", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["quotes"]["VOO"]["price"] == pytest.approx(683.20)
    assert payload["quotes"]["CASH"]["price"] == 1


# --- history tool ---


def test_history_empty_state_on_fixture_dataset(mcp):
    """The fixture data dir carries no history.json — the tool answers an
    empty list with provenance, never an error."""
    async def interact(client):
        return await client.call_tool("vantage.history", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["history"] == []
    assert payload["account"] == "all"
    assert payload["provenance"]["source_type"] == "vantage"


def test_history_round_trip_with_imported_rows(tmp_path, data_dir):
    """Same shape as GET /api/history: newest first, account filter, limit."""
    rows = [
        {"account": "fid-taxable", "broker_account": "...9024",
         "date": "2026-07-02T19:40:00Z", "kind": "option",
         "symbol": "SPXW 2026-07-02 7465C", "description": "d", "side": "buy",
         "quantity": 1.0, "price": 1.72, "amount": -172.0, "state": "filled"},
        {"account": "wf-robo", "broker_account": "...0427",
         "date": "2026-07-03T10:00:00Z", "kind": "equity", "symbol": "VOO",
         "description": "d", "side": "buy", "quantity": 1.0, "price": 683.0,
         "amount": -683.0, "state": "filled"},
    ]
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(),
                                     encoding="utf-8")
    (tmp_path / "history.json").write_text(json.dumps(rows), encoding="utf-8")
    mcp = create_mcp(tmp_path)

    async def all_rows(client):
        return await client.call_tool("vantage.history", {})

    payload = tool_payload(run_with_client(mcp, all_rows))
    assert [r["symbol"] for r in payload["history"]] == [
        "VOO", "SPXW 2026-07-02 7465C"]  # newest first
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{tmp_path}#history"}

    async def filtered(client):
        return await client.call_tool(
            "vantage.history", {"account": "fid-taxable", "limit": 5})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [r["kind"] for r in payload["history"]] == ["option"]


# --- strategies tool ---


def test_strategies_empty_state_on_fixture_dataset(mcp):
    """The fixture data dir carries no strategies.json — the tool answers an
    empty roll-up with provenance, never an error."""
    async def interact(client):
        return await client.call_tool("vantage.strategies", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["open"] == [] and payload["closed"] == []
    assert payload["account"] == "all" and payload["status"] == "all"
    assert payload["provenance"]["source_type"] == "vantage"


def test_strategies_round_trip_with_filters(tmp_path, data_dir):
    rollup = {
        "open": [
            {"underlying": "PLTR", "expiration": "2026-08-21",
             "account": "fid-taxable", "kind": "vertical",
             "name": "bull call (debit) spread", "status": "open"},
            {"underlying": "FISV", "expiration": "2026-08-21",
             "account": "wf-robo", "kind": "multi-leg", "status": "open"},
        ],
        "closed": [
            {"order_id": "oo-1", "_vantage_account": "fid-taxable",
             "underlying": "SPXW", "direction": "credit", "cash": 300.0,
             "state": "filled", "filled": True},
        ],
        "by_ticker": [
            {"underlying": "SOXS", "account": "fid-taxable", "net_cost": 250.0,
             "leg_count": 2, "has_short": True, "spans_expiries": True,
             "status": "open"},
            {"underlying": "PLTR", "account": "wf-robo", "net_cost": 1200.0,
             "leg_count": 1, "has_short": False, "spans_expiries": False,
             "status": "open"},
        ],
        "as_of": "2026-07-05",
    }
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(),
                                     encoding="utf-8")
    (tmp_path / "strategies.json").write_text(json.dumps(rollup), encoding="utf-8")
    mcp = create_mcp(tmp_path)

    async def all_rows(client):
        return await client.call_tool("vantage.strategies", {})

    payload = tool_payload(run_with_client(mcp, all_rows))
    assert len(payload["open"]) == 2 and len(payload["closed"]) == 1
    assert payload["strategies_as_of"] == "2026-07-05"
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{tmp_path}#strategies"}

    async def filtered(client):
        return await client.call_tool(
            "vantage.strategies", {"account": "fid-taxable", "status": "open"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [s["underlying"] for s in payload["open"]] == ["PLTR"]
    assert payload["closed"] == []  # account filter drops account-less closed rows

    # by='ticker' returns the per-underlying position book instead
    async def by_ticker(client):
        return await client.call_tool("vantage.strategies", {"by": "ticker"})

    payload = tool_payload(run_with_client(mcp, by_ticker))
    assert [b["underlying"] for b in payload["by_ticker"]] == ["SOXS", "PLTR"]
    assert payload["by_ticker"][0]["spans_expiries"] is True
    assert "open" not in payload  # ticker view is distinct from strategy view

    # account filter also narrows the ticker view
    async def by_ticker_filtered(client):
        return await client.call_tool(
            "vantage.strategies", {"by": "ticker", "account": "fid-taxable"})

    payload = tool_payload(run_with_client(mcp, by_ticker_filtered))
    assert [b["underlying"] for b in payload["by_ticker"]] == ["SOXS"]


# --- signals tool round-trips (moved with the vantage-mcp split) ---


def test_mcp_signals_round_trip(data_dir):
    mcp = create_mcp(data_dir)

    async def all_signals(client):
        return await client.call_tool("vantage.signals", {})

    payload = tool_payload(run_with_client(mcp, all_signals))
    assert payload["provenance"] == {"source_type": "vantage",
                                     "source_id": f"{data_dir}#signals"}
    assert len(payload["signals"]) == 8

    async def filtered(client):
        return await client.call_tool("vantage.signals", {"symbol": "pltr"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [s["signal"]["sym"] for s in payload["signals"]] == ["PLTR"]
    assert payload["signals"][0]["status"] == "unquoted"


# --- analysis + position_actions tools (the nightly decision journal) ---


def _seed_analysis_dir(tmp_path, data_dir):
    """A data dir with the fixture files + a two-day analysis journal."""
    from vantage_server import analyze, income
    import datetime as _dt

    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json",
                 "signals.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")

    def dec(sym, rec, detail=None):
        return income.PositionDecision(
            symbol=sym, as_of="2026-07-05", current_price=100.0,
            conviction=income.ConvictionView(label="strong", score=0.9),
            recommendation=rec, rule="r", rationale=f"{sym} rationale",
            evidence={"per_tf": {"daily": {}}}, action_detail=detail)

    analyze.write_journal(tmp_path, "2026-07-04", [dec("PLTR", "MONITOR")],
                          now=_dt.datetime(2026, 7, 4, 21, 0, 0))
    analyze.write_journal(
        tmp_path, "2026-07-05",
        [dec("PLTR", "CLOSE_AND_BOOK_LOSS", {"kind": "close", "wash_blocked": False}),
         dec("SOXS", "MONITOR")],
        now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    return tmp_path


def test_analysis_empty_state_on_fixture(data_dir):
    """Fixture data dir has no analysis/ dir — empty decisions, with provenance."""
    mcp = create_mcp(data_dir)

    async def interact(client):
        return await client.call_tool("vantage.analysis", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["decisions"] == []
    assert payload["provenance"]["source_type"] == "vantage"


def test_analysis_latest_date_and_symbol(tmp_path, data_dir):
    mcp = create_mcp(_seed_analysis_dir(tmp_path, data_dir))

    async def latest(client):
        return await client.call_tool("vantage.analysis", {})

    payload = tool_payload(run_with_client(mcp, latest))
    assert payload["date"] == "2026-07-05"
    assert {d["symbol"] for d in payload["decisions"]} == {"PLTR", "SOXS"}

    async def specific(client):
        return await client.call_tool("vantage.analysis", {"date": "2026-07-04"})

    payload = tool_payload(run_with_client(mcp, specific))
    assert [d["symbol"] for d in payload["decisions"]] == ["PLTR"]

    async def filtered(client):
        return await client.call_tool("vantage.analysis", {"symbol": "pltr"})

    payload = tool_payload(run_with_client(mcp, filtered))
    assert [d["symbol"] for d in payload["decisions"]] == ["PLTR"]
    assert payload["decisions"][0]["recommendation"] == "CLOSE_AND_BOOK_LOSS"


def test_position_actions_is_compact(tmp_path, data_dir):
    mcp = create_mcp(_seed_analysis_dir(tmp_path, data_dir))

    async def interact(client):
        return await client.call_tool("vantage.position_actions", {})

    payload = tool_payload(run_with_client(mcp, interact))
    assert payload["date"] == "2026-07-05"
    actions = {a["symbol"]: a for a in payload["actions"]}
    assert set(actions) == {"PLTR", "SOXS"}
    # compact: recommendation + action_detail present, NO evidence block
    assert actions["PLTR"]["recommendation"] == "CLOSE_AND_BOOK_LOSS"
    assert "action_detail" in actions["PLTR"]
    assert "evidence" not in actions["PLTR"]
    assert actions["PLTR"]["conviction"]["label"] == "strong"
