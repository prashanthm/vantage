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

from .base import BrokerConnectionError, option_display_symbol, register_connection
from .base import ReadOnlyViolation  # noqa: F401 — canonical home is base.py; re-exported for back-compat
from .robinhood_auth import AuthError, MCP_URL, get_access_token  # noqa: F401 (AuthError re-exported)

log = logging.getLogger(__name__)

#: The ONLY tools this module will ever invoke. Everything else — notably
#: review/place/cancel order tools — is refused by _call() with
#: ReadOnlyViolation. Extend deliberately, with read-only tools only.
READ_TOOLS = frozenset({
    "get_accounts",
    "get_portfolio",
    "get_equity_positions",
    "get_equity_quotes",
    "get_option_positions",    # list open/closed option positions (read-only)
    "get_option_instruments",  # contract detail (strike/type) by UUID — positions
                               # carry neither, so the breakout needs this lookup
    "get_option_quotes",       # option marks by instrument UUID (read-only)
    "get_equity_orders",       # order HISTORY listing (read-only; never places)
    "get_option_orders",       # option order HISTORY listing (read-only)
    "get_equity_historicals",  # EOD OHLCV bars for technical analysis (read-only)
    "get_pnl_trade_history",   # per-close realized-gain history — the authoritative
                               # win/loss label for round-trip reconstruction (read-only)
})


class RobinhoodError(BrokerConnectionError):
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


def list_accounts() -> list[dict]:
    """The brokerage accounts visible under the grant, normalized.

    ``agentic_allowed: false`` gates TRADING only — every account listed here
    is readable (positions/portfolio), verified against a live non-agentic
    margin account. Returns {account_number, type, nickname, is_default,
    agentic_allowed} per account.
    """
    result = _call("get_accounts", {})
    accounts = result.get("accounts", result if isinstance(result, list) else [result])
    normalized = []
    for a in accounts:
        if not isinstance(a, dict) or not a.get("account_number"):
            continue
        normalized.append({
            "account_number": str(a["account_number"]),
            "type": str(a.get("type") or a.get("brokerage_account_type") or ""),
            "nickname": str(a.get("nickname") or ""),
            "is_default": bool(a.get("is_default")),
            "agentic_allowed": bool(a.get("agentic_allowed")),
        })
    return normalized


# ----------------------------------------------------------- pagination

def _cursor_from_next(next_url) -> str | None:
    """List tools paginate with a 'next' URL whose ``cursor`` query param is
    what the tool's own ``cursor`` argument wants back."""
    if not next_url:
        return None
    from urllib.parse import parse_qs, urlparse

    values = parse_qs(urlparse(str(next_url)).query).get("cursor")
    return values[0] if values else None


def _paged(tool: str, payload: dict, rows_key: str, *, max_rows: int,
           max_pages: int = 25) -> list[dict]:
    """Follow the cursor until max_rows rows, no next page, or max_pages."""
    rows: list[dict] = []
    cursor: str | None = None
    for _ in range(max_pages):
        page_payload = dict(payload)
        if cursor:
            page_payload["cursor"] = cursor
        result = _call(tool, page_payload)
        batch = result.get(rows_key) or result.get("results") or []
        rows.extend(r for r in batch if isinstance(r, dict))
        cursor = _cursor_from_next(result.get("next"))
        if not cursor or len(rows) >= max_rows:
            break
    return rows


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _f(value, default: float = 0.0) -> float:
    """Tolerant float: Robinhood sends numbers as strings ('1982.0000')."""
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# ------------------------------------------------------- option positions

def fetch_option_positions(account_number: str) -> list[dict]:
    """Open option positions, one dict per contract, normalized.

    OBSERVED get_option_positions shape (live, 2026-07-05): {"positions":
    [...], "next": <cursor url|null>}; each row {option_id, chain_id,
    chain_symbol, type ("long"|"short"), quantity ("1.0000"),
    average_price (per CONTRACT — premium/share x multiplier; NEGATIVE for
    shorts, it's the credit received), expiration_date, trade_value_multiplier
    ("100.0000"), opened_at, intraday_*/pending_* fields}. ``nonzero: true``
    returns only currently-open positions (without it the listing includes
    every closed, zero-quantity position ever held — 750 rows on a real
    account). CRUCIALLY the row carries NO strike and NO call/put type;
    those come from get_option_instruments (ids=comma-separated UUIDs ->
    {"instruments": [{id, chain_symbol, expiration_date, strike_price
    ("2.0000"), type ("call"|"put"), state, tradability, min_ticks}]}).
    Marks come from get_option_quotes (instrument_ids=[...] ->
    {"results": [{"quote": {instrument_id, mark_price (PER SHARE),
    adjusted_mark_price, bid/ask, greeks...}, "close": {...}}]}).

    Returned dicts: {underlying, expiration, strike, option_type
    ("call"|"put"), position_type ("long"|"short"), contracts (unsigned
    float), avg_price (per-SHARE premium, unsigned), mark? (per-share, only
    when the quote returned one), multiplier, instrument_id, occ_symbol
    (compact display symbol, None when strike/type lookup failed),
    opened_at?}.
    """
    rows = _paged(
        "get_option_positions",
        {"account_number": account_number, "nonzero": True},
        "positions",
        max_rows=1000,
    )
    open_rows = [r for r in rows if _f(r.get("quantity")) != 0]
    ids = [str(r["option_id"]) for r in open_rows if r.get("option_id")]

    instruments: dict[str, dict] = {}
    marks: dict[str, float] = {}
    for chunk in _chunks(ids, 20):
        inst_result = _call("get_option_instruments", {"ids": ",".join(chunk)})
        for inst in inst_result.get("instruments") or inst_result.get("results") or []:
            if isinstance(inst, dict) and inst.get("id"):
                instruments[str(inst["id"])] = inst
        quote_result = _call("get_option_quotes", {"instrument_ids": list(chunk)})
        for row in quote_result.get("results") or []:
            quote = row.get("quote") if isinstance(row, dict) else None
            if not isinstance(quote, dict) or not quote.get("instrument_id"):
                continue
            mark = quote.get("mark_price") or quote.get("adjusted_mark_price")
            if mark not in (None, ""):
                marks[str(quote["instrument_id"])] = _f(mark)

    out: list[dict] = []
    for r in open_rows:
        oid = str(r.get("option_id") or "")
        inst = instruments.get(oid, {})
        multiplier = _f(r.get("trade_value_multiplier"), 100.0) or 100.0
        strike = _f(inst.get("strike_price"), None) if inst.get("strike_price") else None
        option_type = str(inst.get("type") or "") or None
        underlying = str(r.get("chain_symbol") or inst.get("chain_symbol") or "").upper()
        expiration = str(r.get("expiration_date") or inst.get("expiration_date") or "")
        entry: dict = {
            "underlying": underlying,
            "expiration": expiration,
            "strike": strike,
            "option_type": option_type,
            "position_type": "short" if str(r.get("type") or "").lower() == "short" else "long",
            "contracts": abs(_f(r.get("quantity"))),
            # average_price is per contract and signed by direction; normalize
            # to the unsigned per-SHARE premium (position_type carries direction)
            "avg_price": abs(_f(r.get("average_price"))) / multiplier,
            "multiplier": multiplier,
            "instrument_id": oid,
            "occ_symbol": (
                option_display_symbol(underlying, expiration, strike, option_type)
                if underlying and expiration and strike is not None and option_type
                else None
            ),
            "opened_at": r.get("opened_at"),
        }
        if oid in marks:
            entry["mark"] = marks[oid]
        out.append(entry)
    return out


# ---------------------------------------------------------------- history

def _history_row(broker_account: str, **overrides) -> dict:
    """THE history-row contract (exact keys — mirrored by /api/history,
    vantage.history, and the SPA): account is filled by the importer."""
    row = {
        "account": "",
        "broker_account": broker_account,
        "date": "",
        "kind": "other",
        "symbol": "",
        "description": "",
        "side": "",
        "quantity": 0.0,
        "price": None,
        "amount": 0.0,
        "state": "",
    }
    row.update(overrides)
    return row


def _normalize_equity_order(order: dict, broker_account: str) -> dict:
    """OBSERVED get_equity_orders row (live, 2026-07-05): {id, instrument_id,
    symbol, side ("buy"|"sell"|"sell_short"), type ("market"|"limit"|...),
    state ("filled"|"cancelled"|"failed"|"partially_filled_rest_cancelled"|
    "locate_failed"|...), quantity, cumulative_quantity (filled qty),
    price (limit, may be null), average_price (fill avg, null when unfilled),
    fees, dollar_based_amount, time_in_force, market_hours, trigger,
    placed_agent ("user"|"agentic"|...), created_at, last_transaction_at,
    executions: [{id, price, quantity, timestamp, fees}]}. All numbers are
    strings. Unmappable rows degrade to kind "other" — never dropped."""
    try:
        side_raw = str(order.get("side") or "")
        side = "buy" if side_raw.startswith("buy") else "sell"
        filled = _f(order.get("cumulative_quantity"))
        quantity = filled if filled > 0 else _f(order.get("quantity"))
        avg = order.get("average_price")
        price = _f(avg, None) if avg not in (None, "") else (
            _f(order["price"], None) if order.get("price") not in (None, "") else None
        )
        # amount = money that actually moved: filled shares x fill average,
        # negative for buys; an unfilled/cancelled order moved nothing.
        amount = 0.0
        if filled > 0 and avg not in (None, ""):
            amount = round(filled * _f(avg) * (-1 if side == "buy" else 1), 2)
        symbol = str(order.get("symbol") or "").upper()
        desc = f"{order.get('type') or 'order'} {side_raw} {quantity:g} {symbol}"
        if price is not None:
            desc += f" @ {price:g}"
        return _history_row(
            broker_account,
            date=str(order.get("created_at") or ""),
            kind="equity",
            symbol=symbol,
            description=desc,
            side=side,
            quantity=quantity,
            price=price,
            amount=amount,
            state=str(order.get("state") or ""),
        )
    except Exception:  # defensive: surface, never drop
        return _history_row(
            broker_account,
            date=str(order.get("created_at") or "") if isinstance(order, dict) else "",
            kind="other",
            description=repr(order)[:300],
            state=str(order.get("state") or "unparseable") if isinstance(order, dict) else "unparseable",
        )


def _normalize_option_order(order: dict, broker_account: str) -> list[dict]:
    """OBSERVED get_option_orders row (live, 2026-07-05): {id, chain_id,
    chain_symbol, state ("filled"|"cancelled"|"rejected"|...), type, trigger,
    direction ("debit"|"credit"), quantity, processed_quantity,
    pending_quantity, canceled_quantity, price (per SHARE), stop_price,
    premium (price x multiplier), processed_premium, trade_value_multiplier,
    time_in_force, market_hours, opening_strategy/closing_strategy
    ("long_call"|"long_call_spread"|...), placed_agent, created_at,
    updated_at, legs: [{id, option_id, side ("buy"|"sell"), position_effect
    ("open"|"close"), ratio_quantity, expiration_date, strike_price,
    option_type ("call"|"put"), executions?: [{id, price (per SHARE),
    quantity, settlement_date, trade_date, timestamp}]}]}. Filled legs always
    carried executions in the live capture. One history row per LEG (spreads
    become 2+ rows). Unmappable rows degrade to kind "other" — never dropped.
    """
    try:
        legs = order.get("legs") or []
        if not legs:
            raise ValueError("option order without legs")
        multiplier = _f(order.get("trade_value_multiplier"), 100.0) or 100.0
        direction = str(order.get("direction") or "")
        state = str(order.get("state") or "")
        created = str(order.get("created_at") or "")
        strategy = str(order.get("opening_strategy")
                       or order.get("closing_strategy") or "option order")
        order_qty = _f(order.get("quantity"))
        processed = _f(order.get("processed_quantity"))
        rows = []
        for leg in legs:
            side = "buy" if str(leg.get("side") or "") == "buy" else "sell"
            ratio = _f(leg.get("ratio_quantity"), 1.0) or 1.0
            executions = leg.get("executions") or []
            exec_qty = sum(_f(e.get("quantity")) for e in executions)
            exec_notional = sum(_f(e.get("quantity")) * _f(e.get("price"))
                                for e in executions)
            quantity = exec_qty if exec_qty > 0 else (processed or order_qty) * ratio
            price = (exec_notional / exec_qty) if exec_qty > 0 else (
                _f(order["price"], None) if order.get("price") not in (None, "") else None
            )
            # amount = contract dollars that actually moved on this leg
            # (executions are per share -> x multiplier), negative for buys.
            amount = 0.0
            if exec_qty > 0:
                amount = round(exec_notional * multiplier * (-1 if side == "buy" else 1), 2)
            symbol = option_display_symbol(
                str(order.get("chain_symbol") or ""),
                str(leg.get("expiration_date") or ""),
                _f(leg.get("strike_price")),
                str(leg.get("option_type") or ""),
            )
            desc = f"{strategy} {leg.get('position_effect') or ''} ({direction})".strip()
            rows.append(_history_row(
                broker_account,
                date=created,
                kind="option",
                symbol=symbol,
                description=desc,
                side=side,
                quantity=quantity,
                price=price,
                amount=amount,
                state=state,
            ))
        return rows
    except Exception:  # defensive: surface, never drop
        return [_history_row(
            broker_account,
            date=str(order.get("created_at") or "") if isinstance(order, dict) else "",
            kind="other",
            description=repr(order)[:300],
            state=str(order.get("state") or "unparseable") if isinstance(order, dict) else "unparseable",
        )]


def _option_orders(account_number: str, *, limit: int = 200) -> list[dict]:
    """RAW-but-unwrapped get_option_orders rows (the shape documented in
    _normalize_option_order), newest first. The single network path for option
    orders — both fetch_history and fetch_option_orders read through it."""
    orders = _paged("get_option_orders", {"account_number": account_number},
                    "orders", max_rows=limit)[:limit]
    orders.sort(key=lambda o: str(o.get("created_at") or "") if isinstance(o, dict) else "",
                reverse=True)
    return orders


def fetch_option_orders(account_number: str, *, limit: int = 200) -> list[dict]:
    """Option order HISTORY as RAW-but-unwrapped order dicts (the live
    get_option_orders shape — chain_symbol, opening_strategy/closing_strategy,
    direction, price, state, legs[], ...), newest first.

    Deliberately NOT normalized to history rows: the strategy roll-up
    (strategies.closed_strategies_from_orders) needs the intact per-order,
    per-leg structure that _normalize_option_order flattens to one row per leg.
    Reuses the same allowlisted get_option_orders read as fetch_history — no new
    network path."""
    return _option_orders(account_number, limit=limit)


def fetch_history(account_number: str, *, limit: int = 200) -> list[dict]:
    """Combined equity + option order history, newest first, normalized to
    the history-row contract (see _history_row). ``account`` is left empty —
    the importer fills the Vantage account id; ``broker_account`` is always
    masked to the last four digits."""
    masked = f"...{str(account_number)[-4:]}"
    rows: list[dict] = []
    for order in _paged("get_equity_orders", {"account_number": account_number},
                        "orders", max_rows=limit)[:limit]:
        rows.append(_normalize_equity_order(order, masked))
    for order in _option_orders(account_number, limit=limit):
        rows.extend(_normalize_option_order(order, masked))
    rows.sort(key=lambda r: r.get("date") or "", reverse=True)
    return rows[:limit]


# ------------------------------------------------------ realized P/L history

def _normalize_pnl_row(row: dict) -> dict | None:
    """One raw get_pnl_trade_history row -> the normalized realized-close
    contract {timestamp (ISO), symbol (UNDERLYING, upper), side, quantity
    (float), price (float), realized_gain (float, SIGNED $)}.

    OBSERVED get_pnl_trade_history shape (live, 2026-07-05, post-_unwrap):
    {"results": [{timestamp (ISO), symbol (UNDERLYING, e.g. "SPXW"),
    side (often ""), quantity (str), price (str), realized_gain (str, SIGNED
    $)}]}. Each row is a per-CLOSE realized gain — the authoritative win/loss
    label. Numbers arrive as strings. Returns None for a row missing its
    timestamp or symbol (never fabricates a level)."""
    if not isinstance(row, dict):
        return None
    ts = row.get("timestamp") or row.get("date") or row.get("executed_at")
    symbol = row.get("symbol") or row.get("chain_symbol") or row.get("ticker")
    if not ts:
        return None  # a close with no timestamp cannot be ordered — drop
    # A symbol-less close (Robinhood emits a handful, e.g. assignment/exercise
    # bookings) is KEPT with symbol "" so its authoritative realized_gain is
    # never lost — the reconstructor emits it entry_unknown rather than drop the
    # dollars.
    return {
        "timestamp": str(ts),
        "symbol": str(symbol or "").upper(),
        "side": str(row.get("side") or ""),
        "quantity": _f(row.get("quantity")),
        "price": _f(row.get("price")),
        "realized_gain": _f(row.get("realized_gain")),
    }


def fetch_pnl_trade_history(account_number: str, *, limit: int = 500) -> list[dict]:
    """Per-CLOSE realized-gain history, normalized to
    [{timestamp (ISO), symbol (underlying), side, quantity, price,
    realized_gain (signed $)}], newest first.

    This is the AUTHORITATIVE win/loss label for round-trip reconstruction:
    ``realized_gain`` is the signed dollar P/L Robinhood booked on that close.
    Reads through the allowlisted get_pnl_trade_history tool — one network
    path, no mutation. Rows missing a timestamp or symbol are dropped (never
    fabricated).

    OBSERVED envelope (live, 2026-07-05, post-_unwrap): {account_number, span,
    trades: [{timestamp, symbol, side, quantity (str), price (str),
    realized_gain (str, SIGNED $)}], next_cursor}. Rows live under ``trades``;
    pagination follows ``next_cursor`` — distinct from the order tools' ``next``
    URL + ``results`` shape, so this reads directly rather than via _paged."""
    rows: list[dict] = []
    cursor: str | None = None
    for _ in range(25):
        payload: dict = {"account_number": account_number}
        if cursor:
            payload["cursor"] = cursor
        result = _call("get_pnl_trade_history", payload)
        batch = result.get("trades") or result.get("results") or []
        rows.extend(r for r in batch if isinstance(r, dict))
        cursor = result.get("next_cursor") or _cursor_from_next(result.get("next"))
        if not cursor or len(rows) >= limit:
            break
    out = [nr for r in rows[:limit] if (nr := _normalize_pnl_row(r))]
    out.sort(key=lambda r: r["timestamp"], reverse=True)
    return out


# ------------------------------------------------------ OHLCV historicals

def _historicals_bars(result: dict, symbol: str) -> list[dict]:
    """Pull the raw bar list for ``symbol`` from an unwrapped
    get_equity_historicals payload.

    OBSERVED shape (live, 2026-07-05, post-_unwrap): {"results": [{"symbol",
    "interval", "bounds", "bars": [{begins_at, open_price, close_price,
    high_price, low_price (STRINGS), volume (int), session ("reg")}]}]}. A
    single-symbol call still nests under 'results'; the bar block is matched by
    symbol (case-insensitive), falling back to the sole result when only one is
    present."""
    results = result.get("results")
    if not isinstance(results, list):
        # tolerate a bare {symbol, bars} or {bars} envelope
        if isinstance(result.get("bars"), list):
            return result["bars"]
        return []
    want = symbol.upper()
    match = None
    for r in results:
        if not isinstance(r, dict):
            continue
        if str(r.get("symbol") or "").upper() == want:
            match = r
            break
    if match is None and len(results) == 1 and isinstance(results[0], dict):
        match = results[0]
    if not isinstance(match, dict):
        return []
    bars = match.get("bars")
    return bars if isinstance(bars, list) else []


def _normalize_bar(bar: dict) -> dict | None:
    """One raw historical bar -> the normalized OHLCV contract
    {date (ISO), open, high, low, close (floats), volume (int)}. Returns None
    for a bar missing its timestamp or any price (never fabricates a level)."""
    begins = bar.get("begins_at")
    if not begins:
        return None
    o = bar.get("open_price")
    h = bar.get("high_price")
    low = bar.get("low_price")
    c = bar.get("close_price")
    if any(v in (None, "") for v in (o, h, low, c)):
        return None
    try:
        return {
            "date": str(begins),
            "open": float(o),
            "high": float(h),
            "low": float(low),
            "close": float(c),
            "volume": int(_f(bar.get("volume"))),
        }
    except (TypeError, ValueError):
        return None


def fetch_historicals(
    symbol: str, *, start_time: str, end_time: str | None = None,
    interval: str = "day",
) -> list[dict]:
    """Daily (or interval) OHLCV bars for one symbol, normalized to
    [{date (ISO), open, high, low, close (floats), volume (int)}], oldest ->
    newest.

    ``start_time`` is REQUIRED and must be RFC3339 UTC (e.g.
    "2025-06-01T00:00:00Z") — the server rejects the call without it.
    ``end_time`` is optional. ``interval`` defaults to "day"; weekly/monthly
    aggregation is done by resampling daily bars (see bars.resample), which is
    safer than trusting server interval names. Reads through the allowlisted
    get_equity_historicals tool — one network path, no mutation."""
    payload: dict = {"symbols": [symbol.upper()], "start_time": start_time,
                     "interval": interval}
    if end_time:
        payload["end_time"] = end_time
    result = _call("get_equity_historicals", payload)
    raw = _historicals_bars(result, symbol)
    bars = [nb for b in raw if isinstance(b, dict) and (nb := _normalize_bar(b))]
    bars.sort(key=lambda r: r["date"])
    return bars


def fetch_historicals_batch(
    symbols: list[str], *, start_time: str, end_time: str | None = None,
    interval: str = "day",
) -> dict[str, list[dict]]:
    """Batch variant: fetch daily bars for up to 10 symbols per API call
    (the get_equity_historicals ``symbols`` limit), returning
    {symbol: [normalized bars]}. Symbols the server omitted map to []."""
    out: dict[str, list[dict]] = {}
    uppers = [s.upper() for s in symbols]
    for chunk in _chunks(uppers, 10):
        payload: dict = {"symbols": list(chunk), "start_time": start_time,
                         "interval": interval}
        if end_time:
            payload["end_time"] = end_time
        result = _call("get_equity_historicals", payload)
        for sym in chunk:
            raw = _historicals_bars(result, sym)
            bars = [nb for b in raw if isinstance(b, dict) and (nb := _normalize_bar(b))]
            bars.sort(key=lambda r: r["date"])
            out[sym] = bars
    return out


# ------------------------------------------------------------- connection

@register_connection
class RobinhoodConnection:
    """The BrokerConnection wrapper around this module (see brokers/base.py).

    Deliberately thin: it delegates to the module-level functions above at
    call time (looked up through module globals, so tests that monkeypatch
    ``robinhood.fetch_positions`` etc. keep working). Every remote call still
    funnels through _call() and its READ_TOOLS allowlist — the class adds no
    new network path.
    """

    broker_id = "robinhood"
    display_name = "Robinhood"

    def fetch_positions(self, account_number: str) -> list[dict]:
        return fetch_positions(account_number)

    def fetch_portfolio(self, account_number: str) -> dict:
        return fetch_portfolio(account_number)

    def fetch_option_positions(self, account_number: str) -> list[dict]:
        return fetch_option_positions(account_number)

    def fetch_history(self, account_number: str, *, limit: int = 200) -> list[dict]:
        return fetch_history(account_number, limit=limit)

    def fetch_option_orders(self, account_number: str, *, limit: int = 200) -> list[dict]:
        return fetch_option_orders(account_number, limit=limit)

    def fetch_pnl_trade_history(self, account_number: str, *, limit: int = 500) -> list[dict]:
        return fetch_pnl_trade_history(account_number, limit=limit)

    def fetch_historicals(self, symbol: str, *, start_time: str,
                          end_time: str | None = None,
                          interval: str = "day") -> list[dict]:
        return fetch_historicals(symbol, start_time=start_time,
                                 end_time=end_time, interval=interval)

    def list_accounts(self) -> list[dict]:
        return list_accounts()

    def interactive_auth(self) -> None:
        from . import robinhood_auth
        robinhood_auth.interactive_login()

    def auth_status(self) -> str:
        """Inspect the token store WITHOUT any network call (no refresh)."""
        from . import robinhood_auth
        store = robinhood_auth._load_store()
        path = robinhood_auth.token_file()
        if not store.get("access_token"):
            return f"needs --auth (no token at {path})"
        if time.time() < store.get("expires_at", 0) - 60:
            return f"grant valid (token at {path})"
        if store.get("refresh_token"):
            return f"grant refreshable (access token expired, refresh token at {path})"
        return "needs --auth (token expired, no refresh token)"
