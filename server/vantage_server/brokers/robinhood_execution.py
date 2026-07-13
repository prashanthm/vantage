"""The ONE execution path (ADR-010 v2): reclaim tickets → Robinhood orders.

Ported from sentinel's proven adapter (sentinel/brokers/robinhood.py):
deterministic MCP tool calls to https://agent.robinhood.com/mcp/trading —
no LLM anywhere in the order path — with review-before-place for entries,
dry-run stubs, and transient-error retries. Transport and auth are shared
with the read module (robinhood.py / robinhood_auth.py): one server, one
OAuth grant, two dispatchers with disjoint allowlists.

THE HARD GUARANTEES:

* This module is NOT a broker connection — it is never registered in
  CONNECTIONS, so no importer/refresh/sync path can reach it.
* Every remote call goes through _call_execute(), which refuses — raises
  ExecutionViolation — any tool outside the frozen three-tool
  EXECUTE_TOOLS allowlist, BEFORE any network I/O or ``mcp`` import.
  The read dispatcher (robinhood.py:_call) still refuses all of these
  tools; neither dispatcher can invoke the other's set.
* Dry-run is the default. Live submission requires BOTH the caller to pass
  live=True AND the operator env VANTAGE_LIVE_OK=1; either missing → the
  order set is computed and returned with status "dry_run", nothing sent.
* execute_ticket() accepts only the order_ticket.build_ticket shape — the
  API route recomputes that ticket server-side from reclaim_strategy
  geometry, so arbitrary prices/quantities cannot reach this module.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import os
import time
import uuid

from .base import BrokerConnectionError

log = logging.getLogger(__name__)

#: The ONLY tools this module will ever invoke (ADR-010 v2 carve-out).
#: Deliberately disjoint from robinhood.py's READ_TOOLS.
EXECUTE_TOOLS = frozenset({
    "review_equity_order",   # broker-side pre-flight for an entry
    "place_equity_order",    # the submission
    "cancel_equity_order",   # walk back a resting order
})

#: Env gate for live submission. Anything but "1" → dry-run, always.
LIVE_ENV = "VANTAGE_LIVE_OK"


class ExecutionViolation(Exception):
    """An attempt was made to invoke a tool outside EXECUTE_TOOLS, or to
    go live without the required gates (the ADR-010 v2 hard guarantee)."""


class RobinhoodExecutionError(BrokerConnectionError):
    """The Robinhood MCP server rejected or failed an order call."""


def live_allowed() -> bool:
    """True only when the operator has set VANTAGE_LIVE_OK=1."""
    return os.environ.get(LIVE_ENV, "") == "1"


def _call_execute(tool_name: str, payload: dict, max_retries: int = 3) -> dict:
    """The single entry point for every order-path tool invocation.

    Refuses anything outside EXECUTE_TOOLS before touching the network (or
    importing mcp). Retries transient transport errors with backoff, exactly
    like the read dispatcher; auth/protocol errors surface immediately.
    """
    if tool_name not in EXECUTE_TOOLS:
        raise ExecutionViolation(
            f"tool '{tool_name}' is not in the execution allowlist "
            f"{sorted(EXECUTE_TOOLS)} — the ADR-010 v2 carve-out covers "
            f"reclaim-ticket order tools only"
        )
    # Reuse the read module's transport (_acall): same MCP server, same OAuth
    # grant, same unwrap. Its allowlist lives in _call, not _acall, so this
    # does not weaken the read path's guarantee.
    from . import robinhood as _rh
    from .robinhood_auth import AuthError

    log.info("Robinhood order tool: %s | args=%s", tool_name, json.dumps(payload))
    for attempt in range(1, max_retries + 1):
        try:
            import asyncio
            return asyncio.run(_rh._acall(tool_name, payload))
        except (AuthError, _rh.RobinhoodError, ExecutionViolation):
            raise
        except Exception as e:
            if attempt == max_retries:
                raise RobinhoodExecutionError(
                    f"MCP order call {tool_name} failed after {max_retries} "
                    f"attempts: {e}"
                ) from e
            wait = 2 ** attempt
            log.warning("Transient MCP error calling %s (attempt %d/%d): %s. "
                        "Retrying in %ds...", tool_name, attempt, max_retries,
                        e, wait)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def _extract_order_id(result: dict) -> str:
    order = result.get("order") if isinstance(result.get("order"), dict) else {}
    return str(result.get("id") or result.get("order_id") or order.get("id") or "")


def _place(account_number: str, symbol: str, side: str, order_type: str,
           quantity: int, *, limit_price: float | None = None,
           stop_price: float | None = None, time_in_force: str = "gfd",
           ref_id: str, dry_run: bool, review_first: bool = False) -> dict:
    """One equity order → one normalized result dict.

    Sentinel's eight place_* methods collapsed to one: they differed only in
    side/type/tif and whether a review preceded the placement. Returns
    {success, order_id, symbol, side, type, quantity, limit_price?,
    stop_price?, time_in_force, status, message, raw}.
    """
    if quantity <= 0:
        raise ValueError(f"quantity must be positive, got {quantity}")
    payload: dict = {
        "account_number": account_number,
        "symbol": symbol,
        "side": side,
        "type": order_type,
        "quantity": str(int(quantity)),
        "time_in_force": time_in_force,
    }
    if limit_price is not None:
        payload["limit_price"] = f"{limit_price:.2f}"
    if stop_price is not None:
        payload["stop_price"] = f"{stop_price:.2f}"

    base = {
        "symbol": symbol, "side": side, "type": order_type,
        "quantity": int(quantity), "limit_price": limit_price,
        "stop_price": stop_price, "time_in_force": time_in_force,
    }

    if dry_run:
        log.info("[DRY RUN] Would place: %s", json.dumps(payload))
        return {**base, "success": True, "order_id": f"dry_{ref_id[:8]}",
                "status": "dry_run", "message": "Dry run — no order placed",
                "raw": {}}

    review = None
    if review_first:
        review = _call_execute("review_equity_order", payload)
        log.info("Order review: %s", json.dumps(review))

    result = _call_execute("place_equity_order", {**payload, "ref_id": ref_id})
    order_id = _extract_order_id(result)
    return {**base, "success": bool(order_id), "order_id": order_id,
            "status": str(result.get("state", "placed")),
            "message": str(result.get("reject_reason") or ""),
            "raw": {"review": review, "place": result}}


def cancel_order(account_number: str, order_id: str, *, dry_run: bool = True) -> bool:
    """Cancel a resting equity order. Dry-run always 'succeeds'."""
    if dry_run:
        log.info("[DRY RUN] Would cancel order %s", order_id)
        return True
    result = _call_execute("cancel_equity_order",
                           {"account_number": account_number,
                            "order_id": order_id})
    return bool(result.get("cancelled")) or result.get("status") == "cancelled"


def place_exit_order(account_number: str, symbol: str, position_side: str,
                     qty: int, *, order_type: str,
                     limit_price: float | None = None,
                     stop_price: float | None = None,
                     dry_run: bool = True) -> dict:
    """The ONLY order surface exposed to the exit monitor (ADR-010 v3).

    The order side is DERIVED from the position side (long→sell,
    short→buy-to-cover), so nothing reachable through this function can open
    or increase exposure — reduce-only is structural, not conventional.
    Always GTC: an exit that silently dies at the close protects nothing.
    """
    if position_side not in ("long", "short"):
        raise ValueError(f"position_side must be long|short, got {position_side!r}")
    return _place(account_number, symbol,
                  side="sell" if position_side == "long" else "buy",
                  order_type=order_type, quantity=int(qty),
                  limit_price=limit_price, stop_price=stop_price,
                  time_in_force="gtc", ref_id=uuid.uuid4().hex[:12],
                  dry_run=dry_run)


def order_status(account_number: str, order_id: str) -> dict | None:
    """One equity order's current row from the (read-allowlisted) order
    listing, or None when not yet visible. Read path only — goes through
    robinhood.py's _call and its READ_TOOLS allowlist."""
    from . import robinhood as _rh
    result = _rh._call("get_equity_orders", {"account_number": account_number})
    rows = result.get("orders") or result.get("results") or []
    return next((o for o in rows if o.get("id") == order_id), None)


#: Order states that are terminal (no further fills possible).
TERMINAL_STATES = frozenset({"filled", "cancelled", "rejected", "failed"})


def execute_ticket(ticket: dict, account_number: str, *,
                   live: bool = False, exit_policy: str = "ladder",
                   store=None, fill_wait_sec: float = 20.0) -> dict:
    """Submit a staged reclaim ticket (order_ticket.build_ticket shape). THE
    only path that OPENS exposure (ADR-010 v2); everything after the fill is
    owned by execution_monitor (ADR-010 v3).

    Live sequence — shaped by the no-OCO constraint verified live 2026-07-12
    (Robinhood rejects a take-profit resting beside a stop: "Not enough
    shares to sell"):

    1. entry limit placed (broker-reviewed first);
    2. wait up to ``fill_wait_sec`` for the fill (marketable reclaim entries
       fill in seconds; a resting swing entry just times out here);
    3. filled → the protective stop rests at the broker, GTC (the invariant
       leg — it survives Vantage being offline); not filled → the monitor
       adopts the pending entry and places the stop on fill;
    4. a managed_positions row is recorded (when ``store`` is given) so the
       monitor can run the exit policy: 'ladder' (swap stop→sell when T1
       trades) or 'trailing' (ratchet the stop by the initial stop distance).
       Targets are NEVER placed as resting orders.

    A failed stop leg never aborts (the fill already happened); it is
    surfaced in warnings and the monitor retries. Dry-run (default, or gate
    unset) returns the full would-be order set as stubs and records nothing.

    Returns {mode, symbol, side, exit_policy, legs, ok, warnings,
    managed_position_id?}.
    """
    orders = ticket.get("orders") or {}
    entry, stop, targets = orders.get("entry"), orders.get("stop"), orders.get("targets")
    if not (isinstance(entry, dict) and isinstance(stop, dict)
            and isinstance(targets, list)):
        raise ValueError("not a staged reclaim ticket (orders.entry/stop/targets)")
    if not ticket.get("sized") or int(entry.get("qty") or 0) <= 0:
        raise ValueError("ticket is unsized — risk budget can't afford one "
                         "share at this stop distance; nothing to execute")
    if not account_number:
        raise ValueError("account_number is required")
    if exit_policy not in ("ladder", "trailing"):
        raise ValueError(f"exit_policy must be 'ladder' or 'trailing', got {exit_policy!r}")

    dry_run = not (live and live_allowed())
    if live and not live_allowed():
        raise ExecutionViolation(
            f"live=True but {LIVE_ENV}=1 is not set — refusing. Set the env "
            f"gate to enable live submission (ADR-010 v2), or omit live for "
            f"a dry run."
        )

    symbol = str(ticket["symbol"]).upper()
    side = str(ticket["side"])
    qty = int(entry["qty"])
    stop_price = float(stop["price"])
    target_price = float(targets[0]["price"]) if targets else None
    group = uuid.uuid4().hex
    legs: list[dict] = []
    warnings: list[str] = []

    def _leg(name: str, **kwargs) -> dict | None:
        try:
            result = _place(account_number, symbol, ref_id=f"{group}{name}",
                            dry_run=dry_run, **kwargs)
        except Exception as e:  # post-entry legs must never abort the trade
            warnings.append(f"{name}: {e}")
            log.error("Ticket leg %s failed: %s", name, e)
            return None
        result["leg"] = name
        legs.append(result)
        if not result["success"]:
            warnings.append(f"{name}: {result['status']} {result['message']}".strip())
        return result

    # entry — reviewed, gfd; buy for a long, sell(-short) for a short
    entry_result = _leg(
        "entry", side="buy" if side == "long" else "sell", order_type="limit",
        quantity=qty, limit_price=float(entry["price"]),
        time_in_force="gfd", review_first=True,
    )
    mode = "dry_run" if dry_run else "live"
    if entry_result is None or not entry_result["success"]:
        return {"mode": mode, "symbol": symbol, "side": side,
                "exit_policy": exit_policy, "legs": legs, "ok": False,
                "warnings": warnings + ["entry not placed — nothing to protect"]}

    if dry_run:
        # preview the full would-be order set (stop + monitor-managed exits)
        _leg("stop", side="sell" if side == "long" else "buy",
             order_type="stop_market", quantity=qty,
             stop_price=stop_price, time_in_force="gtc")
        for t in targets:
            if int(t.get("qty") or 0) <= 0:
                continue
            _leg(f"{t.get('name', 'T?')}(monitor)",
                 side="sell" if side == "long" else "buy",
                 order_type="limit", quantity=int(t["qty"]),
                 limit_price=float(t["price"]), time_in_force="gtc")
        return {"mode": mode, "symbol": symbol, "side": side,
                "exit_policy": exit_policy, "legs": legs,
                "ok": all(r["success"] for r in legs), "warnings": warnings}

    # ---- live: wait (briefly) for the entry fill, then rest the stop ------
    entry_id = entry_result["order_id"]
    entry_price = None
    filled = False
    deadline = time.time() + max(0.0, fill_wait_sec)
    while time.time() < deadline:
        time.sleep(min(2.0, max(0.5, fill_wait_sec / 10)))
        row = order_status(account_number, entry_id)
        state = (row or {}).get("state")
        if state == "filled":
            filled = True
            entry_price = float(row.get("average_price") or entry["price"])
            break
        if state in TERMINAL_STATES:
            warnings.append(f"entry {state}: {row.get('reject_reason') or ''}".strip())
            return {"mode": mode, "symbol": symbol, "side": side,
                    "exit_policy": exit_policy, "legs": legs, "ok": False,
                    "warnings": warnings}

    stop_result = None
    if filled:
        stop_result = _leg("stop", side="sell" if side == "long" else "buy",
                           order_type="stop_market", quantity=qty,
                           stop_price=stop_price, time_in_force="gtc")
    else:
        warnings.append(f"entry not filled within {fill_wait_sec:.0f}s — "
                        f"monitor will place the stop on fill")

    managed_id = None
    if store is not None:
        managed_id = store.record_managed_position({
            "opened_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "account_number": account_number,
            "symbol": symbol, "side": side, "qty": float(qty),
            "entry_order_id": entry_id, "entry_price": entry_price,
            "initial_stop": stop_price, "stop_price": stop_price if stop_result and stop_result["success"] else None,
            "stop_order_id": stop_result["order_id"] if stop_result and stop_result["success"] else None,
            "exit_policy": exit_policy, "target_price": target_price,
            "high_water": entry_price,
            "status": "active" if filled else "pending_entry",
            "last_checked": None,
            "note": f"reclaim ticket {group[:8]}",
        })
    elif not dry_run:
        warnings.append("no store — position NOT recorded for the exit "
                        "monitor; manage exits manually")

    return {"mode": mode, "symbol": symbol, "side": side,
            "exit_policy": exit_policy, "legs": legs,
            "ok": all(r["success"] for r in legs),
            "warnings": warnings, "managed_position_id": managed_id}
