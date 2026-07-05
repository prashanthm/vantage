"""Read-only Robinhood client over the Agentic Trading MCP server.

Connects to https://agent.robinhood.com/mcp/trading (streamable HTTP) and
invokes tools deterministically — no LLM anywhere in the path. Auth is the
OAuth grant managed by brokers/robinhood_auth.py.

THE HARD READ-ONLY GUARANTEE (ADR-010): every call goes through _call(),
which refuses — raises ReadOnlyViolation — any tool that is not in the
explicit READ_TOOLS allowlist below. There is no order-placement,
cancellation, or fund-movement code path in this module, and none can be
reached through it. The allowlist check happens BEFORE any network or
``mcp`` import, so it holds even without the optional dependency installed.

The ``mcp`` package is imported lazily, only inside the code paths that
actually talk to the server; install it with:

    pip install -e ".[robinhood]"

LIMITATION: get_equity_positions returns one row per symbol with an AVERAGE
buy price — Robinhood exposes no tax-lot detail here. The importer therefore
synthesizes one lot per position (see importer.py); the statement-CSV path
remains the lot-accurate option.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

from .robinhood_auth import AuthError, MCP_URL, get_access_token  # noqa: F401 (AuthError re-exported)

log = logging.getLogger(__name__)

#: The ONLY tools this module will ever invoke. Everything else — notably
#: review/place/cancel order tools — is refused by _call() with
#: ReadOnlyViolation. Extend deliberately, with read-only tools only.
READ_TOOLS = frozenset({
    "get_portfolio",
    "get_equity_positions",
    "get_equity_quotes",
})


class ReadOnlyViolation(Exception):
    """An attempt was made to invoke a tool outside the read-only allowlist."""


class RobinhoodError(Exception):
    """The Robinhood MCP server returned an error or an unusable payload."""


# Cached tool listing for the process (the server's tool names, which may
# carry namespace prefixes such as 'mcp__robinhood-trading__').
_server_tools: set[str] | None = None


def _require_mcp():
    """Lazy import so the core server install stays mcp-free."""
    try:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client
    except ImportError as e:
        raise RobinhoodError(
            "the 'mcp' package is not installed — the Robinhood sync needs the "
            "optional extra. From server/: .venv/bin/pip install -e \".[robinhood]\""
        ) from e
    return ClientSession, streamablehttp_client


def _resolve_tool(name: str, server_tools: set[str]) -> str:
    """Match a bare tool name against the server's tool list, tolerating
    namespace prefixes like 'mcp__robinhood-trading__'."""
    if name in server_tools:
        return name
    for t in server_tools:
        if t.endswith(name):
            return t
    raise RobinhoodError(
        f"Tool '{name}' not found on MCP server. Available: {sorted(server_tools)}"
    )


def _unwrap(parsed: dict) -> dict:
    """Robinhood wraps payloads as {"data": {...}, "guide": "..."}. Return the
    payload; the 'guide' field is LLM display guidance — untrusted text we
    deliberately never interpret."""
    data = parsed.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        return {"results": data}
    return parsed


async def _acall(tool_name: str, payload: dict) -> dict:
    global _server_tools
    ClientSession, streamablehttp_client = _require_mcp()
    token = get_access_token()
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(MCP_URL, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            if _server_tools is None:
                listed = await session.list_tools()
                _server_tools = {t.name for t in listed.tools}
                log.debug("MCP server tools: %s", sorted(_server_tools))
            resolved = _resolve_tool(tool_name, _server_tools)
            result = await session.call_tool(resolved, payload)

    text = " ".join(
        block.text for block in result.content if getattr(block, "type", "") == "text"
    ).strip()
    if result.isError:
        raise RobinhoodError(f"MCP tool {resolved} returned error: {text[:500]}")

    structured = getattr(result, "structuredContent", None)
    if isinstance(structured, dict):
        return _unwrap(structured)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return _unwrap(parsed)
        return {"results": parsed}
    except (json.JSONDecodeError, ValueError):
        return {"text_response": text}


def _call(tool_name: str, payload: dict, max_retries: int = 3) -> dict:
    """The single entry point for every Robinhood tool invocation.

    Refuses anything outside READ_TOOLS before touching the network (or even
    importing mcp) — this is the enforced ADR-010 read-only guarantee.
    """
    if tool_name not in READ_TOOLS:
        raise ReadOnlyViolation(
            f"tool '{tool_name}' is not in the read-only allowlist "
            f"{sorted(READ_TOOLS)} — Vantage never mutates broker state (ADR-010)"
        )
    for attempt in range(1, max_retries + 1):
        try:
            return asyncio.run(_acall(tool_name, payload))
        except (AuthError, RobinhoodError, ReadOnlyViolation):
            raise
        except Exception as e:
            if attempt == max_retries:
                raise RobinhoodError(
                    f"MCP call {tool_name} failed after {max_retries} attempts: {e}"
                ) from e
            wait = 2 ** attempt
            log.warning("Transient MCP error calling %s (attempt %d/%d): %s. "
                        "Retrying in %ds...", tool_name, attempt, max_retries, e, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


# ------------------------------------------------------------- public reads

def fetch_positions(account_number: str) -> list[dict]:
    """Current equity positions, normalized to
    {symbol, shares, avg_cost, current_price?} dicts.

    Mirrors sentinel's parsing of get_equity_positions: rows live under
    'positions' or 'results'; symbol may be 'symbol' or 'ticker'; quantity is
    'quantity'; cost is 'average_buy_price' (an AVERAGE — no tax lots).
    'current_price' is included only when the payload carries one (positions
    usually don't; quotes are a separate tool)."""
    result = _call("get_equity_positions", {"account_number": account_number})
    rows = result.get("positions") or result.get("results") or []
    positions: list[dict] = []
    for pos in rows:
        if not isinstance(pos, dict):
            continue
        symbol = pos.get("symbol") or pos.get("ticker")
        if not symbol:
            continue
        entry = {
            "symbol": str(symbol).upper(),
            "shares": float(pos.get("quantity") or 0),
            "avg_cost": float(pos.get("average_buy_price") or 0),
        }
        current = pos.get("current_price")
        if current:
            entry["current_price"] = float(current)
        positions.append(entry)
    return positions


def fetch_portfolio(account_number: str) -> dict:
    """The account's portfolio summary (total value, buying power, ...) as the
    unwrapped payload dict. Raises RobinhoodError when no account value is
    present — callers must never substitute a default."""
    result = _call("get_portfolio", {"account_number": account_number})
    value = result.get("total_value") or result.get("equity_value") \
        or result.get("equity") or result.get("market_value")
    if not value:
        raise RobinhoodError(f"Account value missing from portfolio response: {result}")
    return result
