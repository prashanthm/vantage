"""MCP tool surface tests: listing, read-only annotations, call round-trips
via the SDK's in-memory client transport, and the provenance block Mira
grounds on."""
from __future__ import annotations

import asyncio
import json

import pytest

from mcp.shared.memory import create_connected_server_and_client_session

from vantage_server.mcp_server import create_mcp

EXPECTED_TOOLS = {
    "vantage.positions",
    "vantage.allocation",
    "vantage.wash_status",
    "vantage.tlh_candidates",
    "vantage.lots",
    "vantage.quotes",
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
