"""The Alpaca autonomous order path (ADR-015) — the SECOND execution carve-out.

Mirrors robinhood_execution.py's hard guarantees and EXCEEDS them with the four
ADR-015 gates that autonomous entry requires (a human no longer presses execute):

  1. Global kill switch + double env gate (VANTAGE_LIVE_OK + VANTAGE_AUTONOMOUS_OK).
  2. Per-strategy caps (max $/order, max positions, daily max-loss) — checked here
     before every submit; a breach raises CapBreach (the caller auto-pauses).
  3. Manual promotion — enforced by the lifecycle layer (a live strategy is only
     reachable through an operator promote); this module additionally refuses to
     submit for a strategy that isn't marked live-eligible by the caller.
  4. Immutable audit log — every decision (submit/dry-run/refusal/cap-breach) is
     written append-only via the injected `audit` callback before returning.

THE HARD GUARANTEES (same shape as robinhood_execution):
  * NOT a registered broker connection — never in CONNECTIONS; no importer/refresh
    path reaches it.
  * Every remote call goes through _order_call(), which refuses anything outside
    the frozen ORDER_PATHS allowlist, raising ExecutionViolation BEFORE network I/O.
  * Dry-run is the default. A live submit requires BOTH gates set AND the kill
    switch clear AND caps satisfied; any missing → computed order returned as a
    "dry_run" stub, nothing sent.
  * Orders are server-recomputed from strategy geometry by the caller; this module
    validates the shape and never trusts a free-form price/qty/leg list from a client.
  * Structural reduce-only exits: place_exit derives side from the open position.

Transport: stdlib urllib POST/DELETE to the Alpaca REST /v2/orders surface (paper
or live base per ALPACA_PAPER). No new dependency (ADR-014 stdlib pattern). Multi-
leg options are one order with a `legs` array (Alpaca `mleg` order class).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

from .alpaca_broker import _base_url, _creds, is_paper
from .base import BrokerConnectionError

log = logging.getLogger(__name__)

#: The ONLY order-surface paths this module will ever call. Disjoint from the
#: read module's READ_PATHS; anything else refuses before I/O.
ORDER_PATHS = frozenset({
    "POST /v2/orders",       # submit (equity or multi-leg options)
    "DELETE /v2/orders",     # cancel-all
})

#: Env gates. BOTH required for a live autonomous submit (distinct from the
#: reclaim path's lone VANTAGE_LIVE_OK, so enabling one never enables the other).
LIVE_ENV = "VANTAGE_LIVE_OK"
AUTONOMOUS_ENV = "VANTAGE_AUTONOMOUS_OK"
#: Filesystem kill switch: if this file exists, NOTHING submits. A dead-simple
#: out-of-band halt that survives a hung process / an unreachable UI.
KILL_SWITCH_FILE = os.environ.get("VANTAGE_KILL_SWITCH_FILE",
                                  "/run/vantage/AUTONOMOUS_KILL")


class ExecutionViolation(Exception):
    """A tool/path outside ORDER_PATHS, or a live submit without the gates."""


class CapBreach(Exception):
    """A per-strategy cap (size / positions / daily loss) would be exceeded —
    the caller must pause the strategy. Carries which cap and the values."""

    def __init__(self, cap: str, limit: float, attempted: float):
        self.cap, self.limit, self.attempted = cap, limit, attempted
        super().__init__(f"cap '{cap}' breached: attempted {attempted} > limit {limit}")


class AlpacaExecutionError(BrokerConnectionError):
    """The Alpaca order API rejected or failed a call."""


def kill_switch_engaged() -> bool:
    """True when the filesystem kill switch is set — halts every submit."""
    try:
        return os.path.exists(KILL_SWITCH_FILE)
    except OSError:
        return True   # can't tell → fail safe (halt)


def autonomous_allowed() -> bool:
    """True only when BOTH env gates are '1' AND the kill switch is clear.
    Autonomous live entry is off unless the operator has explicitly armed it."""
    return (os.environ.get(LIVE_ENV, "") == "1"
            and os.environ.get(AUTONOMOUS_ENV, "") == "1"
            and not kill_switch_engaged())


def _order_call(op: str, payload: dict, timeout: float = 20.0) -> dict:
    """The single order-path dispatcher. Refuses any op outside ORDER_PATHS
    BEFORE network I/O (the ADR-015 hard guarantee). `op` is one of ORDER_PATHS
    (e.g. 'POST /v2/orders'); the HTTP method + path are taken from it."""
    if op not in ORDER_PATHS:
        raise ExecutionViolation(
            f"op '{op}' is not in the Alpaca order allowlist {sorted(ORDER_PATHS)} "
            f"— the ADR-015 carve-out covers strategy order submission/cancel only."
        )
    method, path = op.split(" ", 1)
    key, secret = _creds()
    data = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(
        _base_url() + path, data=data, method=method,
        headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret,
                 "Content-Type": "application/json"},
    )
    log.info("Alpaca order op: %s | args=%s", op, json.dumps(payload))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300] if e.fp else ""
        raise AlpacaExecutionError(f"Alpaca {op} → HTTP {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise AlpacaExecutionError(f"Alpaca {op} failed: {e}") from e


def _check_caps(caps: dict, *, order_usd: float, open_positions: int,
                day_pnl: float) -> None:
    """Enforce a strategy's caps BEFORE a submit. Raises CapBreach on the first
    violated cap. `caps` = {max_order_usd, max_positions, max_daily_loss_usd}
    (any missing key = that cap is not enforced)."""
    m_usd = caps.get("max_order_usd")
    if m_usd is not None and order_usd > float(m_usd):
        raise CapBreach("max_order_usd", float(m_usd), order_usd)
    m_pos = caps.get("max_positions")
    if m_pos is not None and open_positions >= int(m_pos):
        raise CapBreach("max_positions", int(m_pos), open_positions + 1)
    m_loss = caps.get("max_daily_loss_usd")
    # day_pnl is signed; a loss is negative. Breach when the loss magnitude
    # meets/exceeds the cap (halts opening MORE risk once the day is this red).
    if m_loss is not None and day_pnl <= -abs(float(m_loss)):
        raise CapBreach("max_daily_loss_usd", float(m_loss), -day_pnl)


def submit_strategy_order(order: dict, *, strategy: str, live_eligible: bool,
                          caps: dict, context: dict, audit, live: bool = False,
                          paper: bool = False) -> dict:
    """Submit ONE strategy-recomputed order (equity or multi-leg options).

    `order` is the server-recomputed order shape (validated here, never trusted
    from a client): {symbol, side, qty, type, limit_price?, order_class?, legs?,
    est_usd}. `strategy` names the owning strategy; `caps` are its limits;
    `context` = {open_positions, day_pnl} for the cap check. `audit(record)` is
    the append-only sink — called for EVERY outcome. Returns {mode, order_id?, ...}.

    Two submit modes:
    - **paper=True** (and the endpoint IS paper): PAPER carve-out — submits to the
      Alpaca PAPER account WITHOUT the ADR-015 live-arming gates. Paper is a
      different account/URL (`is_paper()` → PAPER_BASE) that moves no real money,
      so it is not gated like live. Caps are still checked (a sanity bound) and
      every outcome is audited with mode 'paper_submitted'.
    - **live=True**: the four-gate ADR-015 path (kill switch + both env flags +
      live-eligibility + caps) — THE path that opens REAL exposure. Unchanged.
    Neither → dry_run. `paper` is refused if the endpoint is live (a guard so a
    'paper' request can never hit LIVE_BASE)."""
    # shape validation — never trust a free-form order.
    for k in ("symbol", "side", "qty", "type"):
        if not order.get(k):
            raise ValueError(f"order missing required field '{k}'")
    if str(order["side"]).lower() not in ("buy", "sell"):
        raise ValueError(f"order side must be buy|sell, got {order['side']!r}")
    est_usd = float(order.get("est_usd") or 0)

    gates = {
        "live_requested": bool(live),
        "paper_requested": bool(paper),
        "live_env": os.environ.get(LIVE_ENV, "") == "1",
        "autonomous_env": os.environ.get(AUTONOMOUS_ENV, "") == "1",
        "kill_switch": kill_switch_engaged(),
        "live_eligible": bool(live_eligible),
        "paper_endpoint": is_paper(),
    }

    def _audit(mode: str, extra: dict | None = None) -> None:
        rec = {"strategy": strategy, "mode": mode, "order": order,
               "est_usd": est_usd, "gates": gates, "context": context}
        if extra:
            rec.update(extra)
        try:
            audit(rec)
        except Exception:  # noqa: BLE001 — audit must never break the order path,
            log.exception("audit sink failed for %s order", strategy)  # but is logged

    # PAPER carve-out: paper account only, no live-arming gates. Guard: a 'paper'
    # request while the endpoint is LIVE is a hard refusal (never route paper to
    # real money). Caps still checked as a sanity bound.
    if paper:
        if not is_paper():
            _audit("refused", {"reason": "paper submit requested but endpoint is LIVE"})
            raise ExecutionViolation(
                "paper=True but ALPACA_PAPER is off (endpoint is LIVE) — refusing to "
                "route a paper order to the live account.")
        try:
            _check_caps(caps, order_usd=est_usd,
                        open_positions=int(context.get("open_positions") or 0),
                        day_pnl=float(context.get("day_pnl") or 0))
        except CapBreach as cb:
            _audit("cap_breach", {"cap": cb.cap, "limit": cb.limit, "attempted": cb.attempted})
            raise
        body = _alpaca_body(order)
        result = _order_call("POST /v2/orders", body)
        order_id = result.get("id")
        _audit("paper_submitted", {"order_id": order_id, "result_status": result.get("status")})
        return {"mode": "paper", "order_id": order_id, "order": order, "gates": gates,
                "result": result}

    # GATE 3 (promotion): a non-live-eligible strategy can never submit live.
    if live and not live_eligible:
        _audit("refused", {"reason": "strategy not live-eligible (not promoted)"})
        raise ExecutionViolation(
            f"strategy '{strategy}' is not live-eligible — only an operator-promoted "
            f"live strategy may submit real orders (ADR-015 gate 3)."
        )

    # GATE 1 (kill switch + double env): decide dry-run vs live.
    go_live = live and autonomous_allowed()
    if live and not autonomous_allowed():
        # asked for live but a gate blocks it → dry-run, audited (not an exception:
        # the safe degrade is exactly the point of the gate).
        _audit("dry_run", {"reason": "autonomous gate not armed "
                           f"({LIVE_ENV}+{AUTONOMOUS_ENV} + kill switch clear required)"})
        return {"mode": "dry_run", "order": order, "gates": gates}

    if not go_live:
        _audit("dry_run", {"reason": "live not requested"})
        return {"mode": "dry_run", "order": order, "gates": gates}

    # GATE 2 (caps): checked immediately before the live submit.
    try:
        _check_caps(caps, order_usd=est_usd,
                    open_positions=int(context.get("open_positions") or 0),
                    day_pnl=float(context.get("day_pnl") or 0))
    except CapBreach as cb:
        _audit("cap_breach", {"cap": cb.cap, "limit": cb.limit, "attempted": cb.attempted})
        raise

    # all gates passed → build the Alpaca order body + submit.
    body = _alpaca_body(order)
    result = _order_call("POST /v2/orders", body)
    order_id = result.get("id")
    _audit("submitted", {"order_id": order_id, "result_status": result.get("status")})
    return {"mode": "live", "order_id": order_id, "order": order, "gates": gates,
            "result": result}


def place_exit(position_side: str, symbol: str, qty: int, *, strategy: str,
               audit, order_type: str = "market", limit_price: float | None = None,
               stop_price: float | None = None, live: bool = False,
               paper: bool = False) -> dict:
    """Reduce-only exit for a strategy position (ADR-015, mirrors ADR-010 v3).
    Side is DERIVED from the position side, so this can never open/increase
    exposure — structural, not conventional. Exits are NOT capped or
    live-eligibility-gated (reducing risk is always allowed).

    - **paper=True** (endpoint is paper): the PAPER carve-out — submits the
      reduce-only close to Alpaca PAPER without the live-arming gates (the
      scanner-spread stop-loss). Refused if the endpoint is LIVE.
    - **live=True**: kill-switch + env gated for the real submit. Unchanged.
    Always audited."""
    if position_side not in ("long", "short"):
        raise ValueError(f"position_side must be long|short, got {position_side!r}")
    order = {
        "symbol": str(symbol).upper(),
        "side": "sell" if position_side == "long" else "buy",   # reduce-only
        "qty": int(qty), "type": order_type, "est_usd": 0.0,
        "limit_price": limit_price, "stop_price": stop_price,
        "time_in_force": "gtc",   # an exit that dies at the close protects nothing
        "reduce_only": True,
    }
    gates = {"live_requested": bool(live), "paper_requested": bool(paper),
             "autonomous_armed": autonomous_allowed(), "paper_endpoint": is_paper()}

    def _audit(mode: str, extra: dict | None = None) -> None:
        rec = {"strategy": strategy, "mode": mode, "order": order, "exit": True, "gates": gates}
        if extra:
            rec.update(extra)
        try:
            audit(rec)
        except Exception:  # noqa: BLE001
            log.exception("audit sink failed for %s exit", strategy)

    if paper:
        if not is_paper():
            _audit("refused", {"reason": "paper exit requested but endpoint is LIVE"})
            raise ExecutionViolation("paper exit requested but ALPACA_PAPER is off (LIVE endpoint).")
        result = _order_call("POST /v2/orders", _alpaca_body(order))
        _audit("paper_submitted", {"order_id": result.get("id")})
        return {"mode": "paper", "order_id": result.get("id"), "order": order, "result": result}

    if not (live and autonomous_allowed()):
        _audit("dry_run", {"reason": "exit dry-run (gate not armed or live not requested)"})
        return {"mode": "dry_run", "order": order, "gates": gates}
    result = _order_call("POST /v2/orders", _alpaca_body(order))
    _audit("submitted", {"order_id": result.get("id")})
    return {"mode": "live", "order_id": result.get("id"), "order": order, "result": result}


def _alpaca_body(order: dict) -> dict:
    """Map the validated internal order to an Alpaca /v2/orders JSON body.
    Multi-leg options → order_class 'mleg' with a `legs` array; else a plain
    equity/option order. Client never supplies this — the strategy recomputes it."""
    body: dict = {
        "symbol": str(order["symbol"]).upper() if not order.get("legs") else None,
        "side": str(order["side"]).lower(),
        "type": str(order.get("type") or "market"),
        "time_in_force": str(order.get("time_in_force") or "day"),
        "qty": str(int(order["qty"])),
    }
    if order.get("limit_price") is not None:
        body["limit_price"] = str(order["limit_price"])
    if order.get("stop_price") is not None:
        body["stop_price"] = str(order["stop_price"])
    if order.get("reduce_only"):
        body["reduce_only"] = True
    legs = order.get("legs")
    if legs:
        # multi-leg options: one order, N legs, Alpaca 'mleg' class.
        body.pop("symbol", None)
        body["order_class"] = "mleg"
        body["legs"] = [
            {"symbol": str(leg["symbol"]), "side": str(leg["side"]).lower(),
             "ratio_qty": str(int(leg.get("ratio_qty") or 1)),
             "position_intent": str(leg.get("position_intent") or "buy_to_open")}
            for leg in legs
        ]
    return {k: v for k, v in body.items() if v is not None}


def _demo() -> None:
    """assert-based self-check (run: python -m vantage_server.brokers.alpaca_execution).
    Proves every gate WITHOUT any network or credentials: the allowlist refusal,
    dry-run default, the four gates, cap breach, and reduce-only exit shape."""
    audited: list[dict] = []
    audit = audited.append
    base_order = {"symbol": "SPY", "side": "buy", "qty": 10, "type": "market", "est_usd": 4500}

    # allowlist: a non-order op refuses before I/O.
    try:
        _order_call("POST /v2/account", {}); raise AssertionError("no refusal")
    except ExecutionViolation:
        pass

    # dry-run default: live NOT requested → dry_run, nothing sent, audited.
    r = submit_strategy_order(base_order, strategy="reclaim", live_eligible=True,
                              caps={}, context={}, audit=audit)
    assert r["mode"] == "dry_run" and audited[-1]["mode"] == "dry_run", r

    # GATE 3: live requested but strategy not live-eligible → refuse.
    try:
        submit_strategy_order(base_order, strategy="reclaim", live_eligible=False,
                              caps={}, context={}, audit=audit, live=True)
        raise AssertionError("did not refuse non-eligible live")
    except ExecutionViolation:
        assert audited[-1]["mode"] == "refused"

    # GATE 1: live + eligible but env gates unarmed → dry_run (safe degrade).
    for env in (LIVE_ENV, AUTONOMOUS_ENV):
        os.environ.pop(env, None)
    r = submit_strategy_order(base_order, strategy="reclaim", live_eligible=True,
                              caps={}, context={}, audit=audit, live=True)
    assert r["mode"] == "dry_run" and "gate not armed" in audited[-1]["reason"], r

    # GATE 2: caps enforced. Arm the env gates + kill switch clear, then breach.
    os.environ[LIVE_ENV] = "1"; os.environ[AUTONOMOUS_ENV] = "1"
    kf = KILL_SWITCH_FILE
    assert not os.path.exists(kf), "kill switch file must be absent for this check"
    try:
        submit_strategy_order(base_order, strategy="reclaim", live_eligible=True,
                              caps={"max_order_usd": 1000}, context={}, audit=audit, live=True)
        raise AssertionError("cap not enforced")
    except CapBreach as cb:
        assert cb.cap == "max_order_usd" and audited[-1]["mode"] == "cap_breach"
    # max_positions breach
    try:
        submit_strategy_order(base_order, strategy="reclaim", live_eligible=True,
                              caps={"max_positions": 3}, context={"open_positions": 3},
                              audit=audit, live=True)
        raise AssertionError("positions cap not enforced")
    except CapBreach as cb:
        assert cb.cap == "max_positions"
    # daily-loss breach
    try:
        submit_strategy_order(base_order, strategy="reclaim", live_eligible=True,
                              caps={"max_daily_loss_usd": 500}, context={"day_pnl": -600},
                              audit=audit, live=True)
        raise AssertionError("daily-loss cap not enforced")
    except CapBreach as cb:
        assert cb.cap == "max_daily_loss_usd"
    finally:
        os.environ.pop(LIVE_ENV, None); os.environ.pop(AUTONOMOUS_ENV, None)

    # reduce-only exit shape: side derived from position side, tif gtc.
    ex = place_exit("long", "SPY", 10, strategy="reclaim", audit=audit)  # dry-run
    assert ex["order"]["side"] == "sell" and ex["order"]["reduce_only"] is True
    assert ex["order"]["time_in_force"] == "gtc" and ex["mode"] == "dry_run"

    # multi-leg body maps to the mleg order class.
    body = _alpaca_body({"side": "buy", "qty": 1, "type": "limit", "limit_price": 1.2,
                         "legs": [{"symbol": "SPY260117C500", "side": "buy"},
                                  {"symbol": "SPY260117C510", "side": "sell"}]})
    assert body["order_class"] == "mleg" and len(body["legs"]) == 2 and "symbol" not in body

    # PAPER carve-out — the safety-critical guard: a paper request while the endpoint
    # is LIVE must REFUSE (never route paper to real money). Force the live endpoint.
    import vantage_server.brokers.alpaca_broker as _ab
    os.environ["ALPACA_PAPER"] = "0"   # is_paper() → False (LIVE endpoint)
    try:
        submit_strategy_order(base_order, strategy="scanner", live_eligible=False,
                              caps={}, context={}, audit=audit, paper=True)
        raise AssertionError("paper submit to LIVE endpoint was not refused")
    except ExecutionViolation:
        assert audited[-1]["mode"] == "refused"
    try:
        place_exit("long", "SPY", 4, strategy="scanner", audit=audit, paper=True)
        raise AssertionError("paper exit to LIVE endpoint was not refused")
    except ExecutionViolation:
        pass
    # on the PAPER endpoint the carve-out submits WITHOUT the live gates. Stub the
    # network call so no real order is sent; assert it targets the paper submit path.
    os.environ.pop("ALPACA_PAPER", None)   # is_paper() → True (paper default)
    assert _ab.is_paper(), "paper must be the default endpoint"
    _real_call = globals()["_order_call"]
    globals()["_order_call"] = lambda op, payload, timeout=20.0: {"id": "paper-1", "status": "accepted"}
    try:
        r = submit_strategy_order(base_order, strategy="scanner", live_eligible=False,
                                  caps={}, context={}, audit=audit, paper=True)
        assert r["mode"] == "paper" and r["order_id"] == "paper-1", r
        assert audited[-1]["mode"] == "paper_submitted"
        # env gates were NEVER set — the paper path bypassed them by design.
        assert os.environ.get(LIVE_ENV) is None and os.environ.get(AUTONOMOUS_ENV) is None
    finally:
        globals()["_order_call"] = _real_call

    print("ok — alpaca_execution gate self-check passed (incl. paper carve-out)")


if __name__ == "__main__":
    _demo()
