"""The managed-exit monitor (ADR-010 v3): exits-only automation.

Owns every managed position AFTER the entry that POST /api/ticket/execute
placed — because Robinhood's agentic API cannot rest a stop and a take-profit
together (verified live 2026-07-12: the second sell rejects "Not enough
shares to sell"), the take-profit/trail leg must live here as software.

One pass = :func:`tick`. Per open position it:

* ``pending_entry`` — polls the entry order; on fill rests the protective
  stop (GTC, broker-side) and activates; on cancel/reject (or after
  ``reclaim_strategy.PENDING_EXPIRE_HOURS``) closes the row.
* ``active`` — first re-arms a missing stop (the broker-resident stop is the
  invariant: between monitor actions a stop always rests, so monitor
  downtime only pauses trailing/target swaps, never unprotects). Then:
  - detects the stop/exit order filling → closes the row;
  - detects the position flat at the broker (operator closed it manually)
    → cancels the orphan order, closes the row;
  - ``ladder`` policy: when T1 trades, swaps stop → limit sell at T1;
  - ``trailing`` policy: ratchets the stop toward price by the INITIAL stop
    distance (new extreme − trail), cancel→replace, favorable-only.

THE EXITS-ONLY GUARANTEE: every order goes through
``robinhood_execution.place_exit_order``, which derives the order side from
the position side — nothing here can open or increase exposure. Symbols,
sides, and quantities come only from ``managed_positions`` rows (identity
fields the store refuses to mutate). Without ``VANTAGE_LIVE_OK=1`` the
monitor observes and logs but places/cancels nothing.

Run continuously:  python -m vantage_server.execution_monitor [interval_sec]
Run one pass:      POST /api/exits/tick
"""
from __future__ import annotations

import datetime as _dt
import logging
import time

from .brokers import robinhood_execution as rexec
from .brokers.robinhood import _call
from .reclaim_strategy import PENDING_EXPIRE_HOURS

log = logging.getLogger(__name__)

#: Ratchet only when the new stop improves on the resting one by at least
#: max(RATCHET_MIN_ABS, RATCHET_MIN_FRAC * trail distance) — every ratchet is
#: a cancel→replace with a moment of no resting stop, so churn is risk.
RATCHET_MIN_ABS = 0.01
RATCHET_MIN_FRAC = 0.10


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


def last_price(symbol: str) -> float | None:
    """Freshest real trade print via the read-allowlisted quote tool.

    OBSERVED (live, 2026-07-12, overnight session): ``last_trade_price`` is
    the REGULAR-session last (Friday's close on a Sunday night) while
    ``last_non_reg_trade_price`` carries the live overnight prints — anchoring
    a trailing ratchet on the stale one moved a stop off a price that never
    traded that session. Pick whichever print has the newer venue timestamp;
    fall back to last_trade_price when timestamps are missing."""
    result = _call("get_equity_quotes", {"symbols": [symbol]})
    for entry in result.get("results", []):
        quote = entry.get("quote", entry)
        if quote.get("symbol") != symbol:
            continue
        reg = quote.get("last_trade_price")
        non_reg = quote.get("last_non_reg_trade_price")
        reg_t = str(quote.get("venue_last_trade_time") or "")
        non_reg_t = str(quote.get("venue_last_non_reg_trade_time") or "")
        if non_reg and (not reg or (non_reg_t and reg_t and non_reg_t > reg_t)):
            return float(non_reg)
        if reg:
            return float(reg)
    return None


def position_qty(account_number: str, symbol: str) -> float:
    """Broker-side share count for one symbol (0.0 when flat)."""
    from .brokers import robinhood as rh
    for p in rh.fetch_positions(account_number):
        if p["symbol"] == symbol.upper():
            return float(p["shares"])
    return 0.0


def _trail_distance(pos: dict) -> float:
    """The trail width: the position's INITIAL entry→stop distance (the
    user-chosen risk unit). Anchored on the actual fill when known."""
    entry = pos.get("entry_price") or 0.0
    if entry and pos.get("initial_stop"):
        return abs(float(entry) - float(pos["initial_stop"]))
    return 0.0


def _desired_stop(pos: dict) -> float | None:
    """Where the trailing stop SHOULD sit now: extreme − trail (long) or
    extreme + trail (short). None when the anchor data is incomplete."""
    dist = _trail_distance(pos)
    hw = pos.get("high_water")
    if not dist or hw is None:
        return None
    return float(hw) - dist if pos["side"] == "long" else float(hw) + dist


def _exit_reason(pos: dict) -> str:
    """What a filled exit order means for this row: a ladder swap parked the
    exit at the target (stop_price None → 'target'); a trailing stop that
    ratcheted past its initial level exits favorably ('trail'); otherwise
    the original protective stop fired ('stop')."""
    if pos.get("stop_price") is None:
        return "target"
    if pos["exit_policy"] == "trailing" and pos.get("initial_stop") is not None:
        moved = (float(pos["stop_price"]) > float(pos["initial_stop"])
                 if pos["side"] == "long"
                 else float(pos["stop_price"]) < float(pos["initial_stop"]))
        if moved:
            return "trail"
    return "stop"


def tick(store, *, actions: list[dict] | None = None) -> list[dict]:
    """One monitor pass over every open managed position. Returns the action
    log (also mutated in place when a list is passed). Never raises for a
    single position's failure — it logs and moves on; the resting stop is
    the safety net, not this loop."""
    acts: list[dict] = actions if actions is not None else []
    live = rexec.live_allowed()

    def act(pos_id, kind, **detail):
        entry = {"position": pos_id, "action": kind, "live": live, **detail}
        acts.append(entry)
        log.info("exit-monitor %s", entry)

    for pos in store.load_managed_positions("open"):
        pid = pos["id"]
        try:
            if pos["status"] == "pending_entry":
                _tick_pending(store, pos, live, act)
            else:
                _tick_active(store, pos, live, act)
            store.update_managed_position(pid, last_checked=_now())
        except Exception as e:
            act(pid, "error", error=str(e))
            log.error("exit-monitor position %s failed: %s", pid, e)
    return acts


def _tick_pending(store, pos: dict, live: bool, act) -> None:
    """Await the entry fill; activate (rest the stop) or close the row."""
    pid, acct = pos["id"], pos["account_number"]
    row = rexec.order_status(acct, pos["entry_order_id"]) or {}
    state = row.get("state")

    if state == "filled":
        entry_price = float(row.get("average_price") or 0) or None
        filled_qty = float(row.get("cumulative_quantity") or pos["qty"])
        if filled_qty < pos["qty"]:
            act(pid, "partial_fill", filled=filled_qty, expected=pos["qty"])
        stop = rexec.place_exit_order(
            acct, pos["symbol"], pos["side"], int(min(filled_qty, pos["qty"])),
            order_type="stop_market", stop_price=float(pos["initial_stop"]),
            dry_run=not live)
        store.update_managed_position(
            pid, status="active", entry_price=entry_price,
            high_water=entry_price,
            stop_price=float(pos["initial_stop"]) if stop["success"] else None,
            stop_order_id=stop["order_id"] if stop["success"] else None)
        act(pid, "entry_filled", entry_price=entry_price,
            stop_placed=stop["success"])
        return

    if state in rexec.TERMINAL_STATES:
        store.update_managed_position(
            pid, status="closed", closed_at=_now(), exit_reason="never_filled",
            note=f"{pos.get('note') or ''} | entry {state}".strip(" |"))
        act(pid, "entry_dead", state=state)
        return

    opened = _dt.datetime.fromisoformat(pos["opened_at"])
    age_h = (_dt.datetime.now(_dt.timezone.utc) - opened).total_seconds() / 3600
    if age_h > PENDING_EXPIRE_HOURS:
        if live:
            rexec.cancel_order(acct, pos["entry_order_id"], dry_run=False)
        store.update_managed_position(
            pid, status="closed", closed_at=_now(), exit_reason="never_filled",
            note=f"{pos.get('note') or ''} | expired after {age_h:.0f}h".strip(" |"))
        act(pid, "entry_expired", age_hours=round(age_h, 1))


def _tick_active(store, pos: dict, live: bool, act) -> None:
    """Protect, then improve: re-arm a missing stop, detect exits, and run
    the position's exit policy."""
    pid, acct, sym = pos["id"], pos["account_number"], pos["symbol"]

    # 1. Did our resting exit order fill (stop fired / target sell filled)?
    if pos.get("stop_order_id"):
        row = rexec.order_status(acct, pos["stop_order_id"]) or {}
        state = row.get("state")
        if state == "filled":
            store.update_managed_position(
                pid, status="closed", closed_at=_now(),
                exit_reason=_exit_reason(pos),
                exit_price=float(row.get("average_price") or 0) or None)
            act(pid, "closed", reason=_exit_reason(pos),
                exit_price=row.get("average_price"))
            return
        if state in rexec.TERMINAL_STATES:  # cancelled/rejected outside us
            act(pid, "exit_order_dead", state=state)
            store.update_managed_position(pid, stop_order_id=None)
            pos = {**pos, "stop_order_id": None}

    # 2. Operator closed it manually? Flat at the broker → tidy up.
    if live and position_qty(acct, sym) <= 0:
        if pos.get("stop_order_id"):
            rexec.cancel_order(acct, pos["stop_order_id"], dry_run=False)
        store.update_managed_position(
            pid, status="closed", closed_at=_now(), exit_reason="adopted_flat",
            note=f"{pos.get('note') or ''} | flat at broker".strip(" |"))
        act(pid, "adopted_flat")
        return

    # 3. No resting protection? Re-arm before anything else.
    if not pos.get("stop_order_id"):
        level = _desired_stop(pos) if pos["exit_policy"] == "trailing" else None
        level = level or pos.get("stop_price") or pos.get("initial_stop")
        stop = rexec.place_exit_order(acct, sym, pos["side"], int(pos["qty"]),
                                      order_type="stop_market",
                                      stop_price=float(level),
                                      dry_run=not live)
        act(pid, "stop_rearmed", level=level, ok=stop["success"])
        if stop["success"] and live:
            store.update_managed_position(pid, stop_price=float(level),
                                          stop_order_id=stop["order_id"])
            pos = {**pos, "stop_price": float(level),
                   "stop_order_id": stop["order_id"]}
        else:
            return  # nothing else until protection rests

    price = last_price(sym)
    if price is None:
        act(pid, "no_quote")
        return

    long = pos["side"] == "long"

    # 4a. Ladder: T1 trading → swap the stop for the target sell.
    if pos["exit_policy"] == "ladder":
        tgt = pos.get("target_price")
        if tgt and ((long and price >= float(tgt))
                    or (not long and price <= float(tgt))):
            if not live:
                act(pid, "target_hit_observed", price=price, target=tgt)
                return
            rexec.cancel_order(acct, pos["stop_order_id"], dry_run=False)
            sell = rexec.place_exit_order(acct, sym, pos["side"],
                                          int(pos["qty"]), order_type="limit",
                                          limit_price=float(tgt),
                                          dry_run=False)
            if sell["success"]:
                # stop_price=None marks the resting order as the target leg
                store.update_managed_position(pid, stop_order_id=sell["order_id"],
                                              stop_price=None)
                act(pid, "target_swap", target=tgt)
            else:
                # swap failed mid-air: drop the id; step 3 re-arms next tick
                store.update_managed_position(pid, stop_order_id=None)
                act(pid, "target_swap_failed", detail=sell["message"])
        return

    # 4b. Trailing: ratchet the stop by the initial distance, favorable only.
    hw = pos.get("high_water") or pos.get("entry_price") or price
    new_hw = max(float(hw), price) if long else min(float(hw), price)
    if new_hw != hw:
        store.update_managed_position(pid, high_water=new_hw)
        pos = {**pos, "high_water": new_hw}
    desired = _desired_stop(pos)
    current = pos.get("stop_price")
    if desired is None or current is None:
        return
    step = max(RATCHET_MIN_ABS, RATCHET_MIN_FRAC * _trail_distance(pos))
    improves = (desired >= float(current) + step if long
                else desired <= float(current) - step)
    if not improves:
        return
    if not live:
        act(pid, "ratchet_observed", to=round(desired, 2))
        return
    rexec.cancel_order(acct, pos["stop_order_id"], dry_run=False)
    stop = rexec.place_exit_order(acct, sym, pos["side"], int(pos["qty"]),
                                  order_type="stop_market",
                                  stop_price=round(desired, 2), dry_run=False)
    if stop["success"]:
        store.update_managed_position(pid, stop_price=round(desired, 2),
                                      stop_order_id=stop["order_id"])
        act(pid, "ratchet", to=round(desired, 2))
    else:
        store.update_managed_position(pid, stop_price=round(desired, 2),
                                      stop_order_id=None)
        act(pid, "ratchet_replace_failed", detail=stop["message"])


def run_loop(store, interval_sec: float = 30.0) -> None:  # pragma: no cover
    """Poll forever. The operator runs this beside the stack while managed
    positions are open (tmux/launchd); crashing out is safe — the broker-side
    stop keeps resting."""
    log.info("exit monitor: %ss interval, live=%s", interval_sec,
             rexec.live_allowed())
    while True:
        started = time.time()
        try:
            tick(store)
        except Exception as e:
            log.error("exit monitor tick failed: %s", e)
        time.sleep(max(1.0, interval_sec - (time.time() - started)))


def main() -> None:  # pragma: no cover
    import sys
    from .store import Store
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    interval = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
    run_loop(Store(None), interval)


if __name__ == "__main__":  # pragma: no cover
    main()
