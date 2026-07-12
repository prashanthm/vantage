"""Risk/reward math over the operator's stored plan — the bet, computed.

A plan (thesis/target/stop) plus the current price defines the trade's
geometry: upside to target, downside to stop, and their ratio. A fund analyst
computes this before weighing any signal; this module makes it deterministic
so the agent layer never does the arithmetic itself.

PURE, I/O-free. Every field is nullable and every degenerate case carries an
explicit ``status`` — never an estimate:

* no plan ......................... None (caller reports "no plan on file")
* target or stop missing .......... status "incomplete_plan" (partial fields)
* price at/under stop ............. status "stop_breached"
* price at/over target ............ status "target_reached"
* stop >= price (no downside room)  ratio undefined -> None
"""
from __future__ import annotations


def risk_reward(plan: dict | None, price: float | None) -> dict | None:
    """The plan's trade geometry at ``price``, or None when there is no plan."""
    if not isinstance(plan, dict):
        return None
    target = _num(plan.get("target"))
    stop = _num(plan.get("stop"))
    px = _num(price)

    out: dict = {
        "price": px,
        "target": target,
        "stop": stop,
        "upside": None,
        "downside": None,
        "rr_ratio": None,
        "upside_pct": None,
        "downside_pct": None,
        "status": "ok",
    }
    if px is None or target is None or stop is None:
        out["status"] = "incomplete_plan"
        return out
    if px <= stop:
        out["status"] = "stop_breached"
    elif px >= target:
        out["status"] = "target_reached"

    upside = target - px
    downside = px - stop
    out["upside"] = round(upside, 2)
    out["downside"] = round(downside, 2)
    out["upside_pct"] = round(upside / px * 100.0, 1) if px else None
    out["downside_pct"] = round(downside / px * 100.0, 1) if px else None
    if downside > 0:
        out["rr_ratio"] = round(upside / downside, 2)
    return out


def _num(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f
