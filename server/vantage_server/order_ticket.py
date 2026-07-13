"""Staged order tickets — everything up to the trigger-pull, nothing past it.

The deliberate ADR-010 boundary: Vantage computes and stages the COMPLETE
order set for a trade (entry, stop, laddered targets, risk-based quantity) and
hands it to the operator as a reviewable ticket; the operator places it in
their broker's own interface. No broker order endpoint is ever touched — this
module is pure computation, no I/O, no side effects.

Geometry comes from :mod:`reclaim_strategy` (the single source of truth), so a
ticket for a reclaim signal is byte-for-byte the trade the paper track and the
Pine artifacts describe.

Sizing: ``qty = floor(risk_amount / per-share risk)`` — the "how many shares
so a stop-out costs exactly $X" arithmetic that otherwise gets done in a hurry
at signal time. Scale-out splits the qty evenly across the target ladder with
the remainder on T1 (the highest-probability leg).
"""
from __future__ import annotations

import math
from typing import Any

from . import reclaim_strategy as spec

#: Default fraction of the ladder qty parked at each target when scaling out.
#: Even split; remainder goes to T1.
DEFAULT_RISK_AMOUNT = 100.0

#: Indexes are NOT directly buyable — a share ticket must be staged in the
#: tradeable proxy ETF, with every price rescaled by the live proxy/index
#: ratio. (Futures/options routes exist too; the ETF is the share-for-share
#: default.)
INDEX_PROXY = {"SPX": "SPY", "XSP": "SPY", "NDX": "QQQ", "RUT": "IWM"}


def proxy_for(symbol: str) -> str | None:
    """The tradeable proxy ETF for an index symbol, or None when ``symbol`` is
    already directly tradeable."""
    return INDEX_PROXY.get((symbol or "").upper())


def rescale(values: list[float], ratio: float) -> list[float]:
    """Index-point prices -> proxy prices via ``ratio`` (proxy_last/index_spot).
    Pure; rounding to cents happens at ticket render."""
    return [v * ratio for v in values]


def size_for_risk(entry: float, stop: float, risk_amount: float) -> int:
    """Shares such that a full stop-out loses ~``risk_amount``. Floor, never
    round up (never risk more than asked). 0 when the stop is at/through the
    entry (degenerate) or the risk budget can't afford one share."""
    per_share = abs(entry - stop)
    if per_share <= 0 or risk_amount <= 0:
        return 0
    return int(math.floor(risk_amount / per_share))


def split_across_targets(qty: int, n_targets: int) -> list[int]:
    """Scale-out allocation: ``qty`` split evenly across ``n_targets`` legs,
    remainder to the FIRST target (the highest-probability leg). Empty when
    there is nothing to split."""
    if qty <= 0 or n_targets <= 0:
        return []
    base, rem = divmod(qty, n_targets)
    out = [base] * n_targets
    out[0] += rem
    return [q for q in out if q > 0] or []


def build_ticket(symbol: str, side: str, level: float,
                 supports: list[float], resistances: list[float],
                 risk_amount: float = DEFAULT_RISK_AMOUNT,
                 currency: str = "USD",
                 derived_from: dict[str, Any] | None = None) -> dict[str, Any]:
    """The staged ticket for a reclaim trade at ``level``: entry/stop from the
    shared spec, the target ladder, risk-based qty, per-leg scale-out, and the
    dollar outcomes at each leg. Pure function — computes, never places.

    ``side`` is "long" or "short". Raises ValueError on a bad side/level so a
    caller can't stage a nonsense ticket.
    """
    if side not in ("long", "short"):
        raise ValueError(f"side must be 'long' or 'short', got {side!r}")
    if not level or level <= 0:
        raise ValueError(f"level must be positive, got {level!r}")

    entry = float(level)
    stop = spec.stop_for(entry, side)
    ladder = spec.target_ladder(entry, side, supports, resistances)
    qty = size_for_risk(entry, stop, risk_amount)
    legs = split_across_targets(qty, len(ladder))

    targets = []
    for i, (tgt, leg_qty) in enumerate(zip(ladder, legs), start=1):
        targets.append({
            "name": f"T{i}",
            "price": round(tgt, 2),
            "qty": leg_qty,
            "risk_reward": spec.risk_reward(entry, stop, tgt),
            "gain_at_target": round(abs(tgt - entry) * leg_qty, 2),
        })

    per_share_risk = round(abs(entry - stop), 4)
    return {
        "symbol": symbol.upper(),
        "side": side,
        "currency": currency,
        # the orders, in the sequence they'd be placed
        "orders": {
            "entry": {"type": "limit", "action": "BUY" if side == "long" else "SELL",
                      "price": round(entry, 2), "qty": qty},
            "stop": {"type": "stop", "action": "SELL" if side == "long" else "BUY",
                     "price": round(stop, 2), "qty": qty},
            "targets": targets,
        },
        "risk": {
            "amount_requested": risk_amount,
            "per_share": per_share_risk,
            "max_loss_at_stop": round(per_share_risk * qty, 2),
            "stop_pad_pct": spec.STOP_PAD_PCT,
        },
        "sized": qty > 0,
        # set when the ticket was rescaled from an untradeable index (SPX->SPY):
        # {index, index_level, ratio} so the operator can verify the mapping.
        "derived_from": derived_from,
        "note": ("STAGED ONLY — review and place in your broker. Vantage never "
                 "places orders (ADR-010)."),
    }


def render_ticket(ticket: dict[str, Any]) -> str:
    """The ticket as a compact copy-paste text block for manual entry."""
    o = ticket["orders"]
    ccy = ticket.get("currency", "USD")
    df = ticket.get("derived_from")
    lines = [
        f"{ticket['side'].upper()} {ticket['symbol']}  ({ccy}, staged — place manually)",
    ]
    if df:
        lines.append(f"  from {df['index']} {df['index_level']} @ ratio {round(df['ratio'], 5)}"
                     f"  ({df['index']} is an index — trading the {ticket['symbol']} proxy)")
    lines += [
        f"  entry  {o['entry']['action']} {o['entry']['qty']} @ {o['entry']['price']} limit",
        f"  stop   {o['stop']['action']} {o['stop']['qty']} @ {o['stop']['price']} stop"
        f"  (max loss {ticket['risk']['max_loss_at_stop']})",
    ]
    for t in o["targets"]:
        rr = f"  R:R {t['risk_reward']}" if t["risk_reward"] is not None else ""
        lines.append(f"  {t['name']}     {o['stop']['action']} {t['qty']} @ {t['price']} limit{rr}")
    if not ticket["sized"]:
        lines.append("  (risk budget too small for 1 share at this stop distance)")
    return "\n".join(lines)
