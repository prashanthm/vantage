"""Options STRATEGY roll-up — a pure engine (no I/O) that layers strategy-level
P&L on top of the per-leg option positions the importer already normalizes.

Two independent builders, both deterministic and side-effect-free:

  group_open_strategies(option_positions, as_of=...)
      Group CURRENTLY-OPEN option positions (brokers' fetch_option_positions
      shape) by (account?, underlying, expiration) and classify each group as a
      single, a named vertical spread, a multi-leg, or a complex strategy.
      SHORT LEGS ARE INCLUDED here — that is the whole point of the roll-up: it
      NETS long and short legs, unlike the lots view (importer.option_lots_and_
      quotes), which skips shorts because the engine rejects negative shares.

  closed_strategies_from_orders(option_orders)
      One strategy row per multi-leg (or single-leg) ORDER from the option
      order history (brokers' get_option_orders shape, unwrapped). This is the
      honest realized view: Robinhood reports a spread as a SINGLE order, so one
      order = one strategy row. Filled orders carry realized cash; cancelled/
      rejected orders are included with their state so the UI can mute them.

Neither builder reads or writes disk. The importer feeds them and writes the
result to data-local/strategies.json; the API/MCP read that file.

DATES / P&L SIGN CONVENTIONS
  * avg_price / mark on an open leg are PER-SHARE (the fetch_option_positions
    contract); leg dollars = price x contracts x multiplier.
  * net_cost is SIGNED as a debit: positive = you paid net (bought the
    strategy), negative = you were paid net (a credit strategy).
  * current_value = Σ(long mark $) − Σ(short mark $): what it is worth now if
    you unwound at the mark.
  * unrealized = current_value − net_cost.
"""
from __future__ import annotations

from datetime import date


# --------------------------------------------------------------------- helpers

def _f(value, default: float | None = 0.0) -> float | None:
    """Tolerant float: broker numbers arrive as strings ('1982.0000')."""
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _dte(expiration: str, as_of: str | None) -> int | None:
    """Whole calendar days from as_of (an ISO date, YYYY-MM-DD) to expiration.
    None when either date is unparseable — never guesses a clock."""
    if not expiration or not as_of:
        return None
    try:
        exp = date.fromisoformat(str(expiration)[:10])
        today = date.fromisoformat(str(as_of)[:10])
    except ValueError:
        return None
    return (exp - today).days


def _leg_dollars(leg: dict, price_key: str) -> float:
    """price x contracts x multiplier for one open leg, using price_key
    ('avg_price' for cost, 'mark' for current value). 0 when the price is
    absent (an unmarked leg contributes nothing to current_value)."""
    price = _f(leg.get(price_key), None)
    if price is None:
        return 0.0
    contracts = _f(leg.get("contracts")) or 0.0
    multiplier = _f(leg.get("multiplier"), 100.0) or 100.0
    return price * contracts * multiplier


def _all_marked(legs: list[dict]) -> bool:
    return all(_f(leg.get("mark"), None) is not None for leg in legs)


# ------------------------------------------------------- A. open strategies

def _qty(leg: dict) -> float:
    """The contract count of an open leg (its own quantity — ratio weighting is
    inherent because each leg carries its real ``contracts``)."""
    return _f(leg.get("contracts")) or 0.0


def _butterfly_name(legs: list[dict]) -> str | None:
    """Name a 3-strike, same-type, same-expiry, ratio-1-2-1 butterfly by
    geometry, or None when the geometry doesn't fit.

    A long butterfly buys the wings (low + high strike) and sells 2x the body
    (middle strike); a short butterfly is the mirror. Verified live shape:
    ``sell 2x mid, buy 1x low, buy 1x high`` = long call butterfly."""
    if len(legs) != 3:
        return None
    types = {str(l.get("option_type", "")).lower()[:1] for l in legs}
    if len(types) != 1:
        return None
    strikes = sorted(_f(l.get("strike")) for l in legs
                     if _f(l.get("strike"), None) is not None)
    if len(strikes) != 3 or strikes[0] == strikes[1] or strikes[1] == strikes[2]:
        return None  # need three distinct strikes
    by_strike = {}
    for leg in legs:
        by_strike[_f(leg.get("strike"))] = leg
    low, mid, high = strikes
    wings = [by_strike[low], by_strike[high]]
    body = by_strike[mid]
    # Equal-width wings and a 1-2-1 quantity ratio (wing qty : body qty = 1:2).
    wing_qty = _qty(wings[0])
    if wing_qty <= 0 or _qty(wings[1]) != wing_qty:
        return None
    if _qty(body) != 2 * wing_qty:
        return None
    wing_sides = {w.get("position_type") for w in wings}
    if len(wing_sides) != 1 or body.get("position_type") in wing_sides:
        return None  # wings same side, body opposite
    otype = "call" if "c" in types else "put"
    direction = "long" if wings[0].get("position_type") == "long" else "short"
    return f"{direction} {otype} butterfly"


def _iron_name(legs: list[dict]) -> str | None:
    """Name a 4-leg 2-put/2-call same-expiry iron condor / iron butterfly by
    geometry, or None. Short inner strikes + long outer wings on both sides is a
    condor; when the two short strikes coincide it's an iron butterfly."""
    if len(legs) != 4:
        return None
    calls = [l for l in legs if str(l.get("option_type", "")).lower().startswith("c")]
    puts = [l for l in legs if str(l.get("option_type", "")).lower().startswith("p")]
    if len(calls) != 2 or len(puts) != 2:
        return None
    exps = {str(l.get("expiration") or "") for l in legs}
    if len(exps) != 1:
        return None

    def short_long(pair):
        shorts = [l for l in pair if l.get("position_type") == "short"]
        longs = [l for l in pair if l.get("position_type") == "long"]
        if len(shorts) != 1 or len(longs) != 1:
            return None
        return shorts[0], longs[0]

    call_sl = short_long(calls)
    put_sl = short_long(puts)
    if call_sl is None or put_sl is None:
        return None
    short_call, long_call = call_sl
    short_put, long_put = put_sl
    # Condor geometry: long call above short call, long put below short put.
    if not (_f(long_call.get("strike")) > _f(short_call.get("strike"))):
        return None
    if not (_f(long_put.get("strike")) < _f(short_put.get("strike"))):
        return None
    if _f(short_call.get("strike")) == _f(short_put.get("strike")):
        return "iron butterfly"
    return "iron condor"


def _classify(legs: list[dict]) -> tuple[str, str]:
    """Return (kind, name) for a group of open legs (sorted by strike).

    kind ∈ {"single", "vertical", "butterfly", "iron", "multi-leg",
    "calendar", "complex"}. Multi-leg structures are recognized by leg
    GEOMETRY (strikes/expiries/quantities), never by a broker-supplied name —
    Robinhood labels every 3+ leg custom order "custom", so the name is useless
    for classification. Anything that fits no template stays "complex (<n>)".
    """
    n = len(legs)
    if n == 1:
        leg = legs[0]
        side = "long" if leg.get("position_type") == "long" else "short"
        otype = "call" if str(leg.get("option_type", "")).lower().startswith("c") else "put"
        return "single", f"{side} {otype}"

    types = {str(l.get("option_type", "")).lower()[:1] for l in legs}
    sides = [l.get("position_type") for l in legs]
    exps = {str(l.get("expiration") or "") for l in legs}

    if n == 2 and len(types) == 1 and set(sides) == {"long", "short"}:
        # Two legs, same type, one long one short.
        if len(exps) > 1:
            # Same type, opposite sides, different expiries → calendar/diagonal.
            otype = "call" if "c" in types else "put"
            return "calendar", f"calendar/diagonal ({otype})"
        # A classic vertical.
        otype = "call" if "c" in types else "put"
        long_leg = next(l for l in legs if l.get("position_type") == "long")
        short_leg = next(l for l in legs if l.get("position_type") == "short")
        long_k = _f(long_leg.get("strike")) or 0.0
        short_k = _f(short_leg.get("strike")) or 0.0
        # Bullish when the long leg is the lower-strike call (you profit as the
        # underlying rises) or the higher-strike put. Debit when you pay to open
        # the bull-call / bear-put; credit when you're paid for bull-put / bear-call.
        if otype == "call":
            if long_k < short_k:
                return "vertical", "bull call (debit) spread"
            return "vertical", "bear call (credit) spread"
        # puts
        if long_k < short_k:
            return "vertical", "bull put (credit) spread"
        return "vertical", "bear put (debit) spread"

    if n == 2 and len(types) == 1 and len(set(sides)) == 1:
        # Two legs, same type, same side. Different expiry → calendar/diagonal;
        # otherwise a ratio or two separate longs (the FISV 50C + 60C both-long
        # case). Don't over-classify.
        otype = "call" if "c" in types else "put"
        if len(exps) > 1:
            return "calendar", f"calendar/diagonal ({otype})"
        return "multi-leg", f"multi-leg ({otype})"

    if n == 3:
        bf = _butterfly_name(legs)
        if bf is not None:
            return "butterfly", bf

    if n == 4:
        iron = _iron_name(legs)
        if iron is not None:
            return "iron", iron

    return "complex", f"complex ({n} legs)"


def _max_profit_loss(kind: str, name: str, legs: list[dict],
                     net_cost: float) -> tuple[float | None, float | None]:
    """max_profit / max_loss for a classic 2-leg vertical, else (None, None).

    Width = |strike difference| x contracts x multiplier (contracts equal on a
    vertical). Debit spread: max_loss = net_cost (debit paid), max_profit =
    width − net_cost. Credit spread: max_profit = |net_cost| (credit received),
    max_loss = width − |credit|. net_cost is signed (debit positive)."""
    if kind != "vertical" or len(legs) != 2:
        return None, None
    k0 = _f(legs[0].get("strike"), None)
    k1 = _f(legs[1].get("strike"), None)
    if k0 is None or k1 is None:
        return None, None
    contracts = _f(legs[0].get("contracts")) or 0.0
    multiplier = _f(legs[0].get("multiplier"), 100.0) or 100.0
    width = abs(k0 - k1) * contracts * multiplier
    if "debit" in name:
        return round(width - net_cost, 2), round(net_cost, 2)
    # credit spread: net_cost is negative (you were paid |net_cost|)
    credit = -net_cost
    return round(credit, 2), round(width - credit, 2)


def group_open_strategies(
    option_positions: list[dict], *, as_of: str | None = None
) -> list[dict]:
    """Roll per-leg open option positions up into strategies.

    Groups by (account, underlying, expiration) — ``account`` participates only
    when the positions carry one (fetch_option_positions does not, so a single
    account collapses to (underlying, expiration)). Each group is classified and
    priced. SHORT LEGS ARE INCLUDED and netted against longs.

    Returns a list of strategy dicts, sorted by (underlying, expiration), each:
      {underlying, expiration, account?, kind, name, dte, status "open",
       legs: [...the normalized leg dicts...],
       net_cost, current_value, unrealized, max_profit, max_loss}
    """
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for opt in option_positions:
        underlying = str(opt.get("underlying") or "").upper()
        expiration = str(opt.get("expiration") or "")
        account = opt.get("account")
        key = (account, underlying, expiration)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(opt)

    strategies: list[dict] = []
    for key in order:
        account, underlying, expiration = key
        legs = sorted(
            groups[key],
            key=lambda l: (_f(l.get("strike")) or 0.0,
                           str(l.get("option_type") or "")),
        )
        kind, name = _classify(legs)

        # net_cost (signed debit): Σ long cost − Σ short cost.
        net_cost = 0.0
        current_value = 0.0
        for leg in legs:
            cost = _leg_dollars(leg, "avg_price")
            mark = _leg_dollars(leg, "mark")
            if leg.get("position_type") == "long":
                net_cost += cost
                current_value += mark
            else:
                net_cost -= cost
                current_value -= mark
        net_cost = round(net_cost, 2)
        # current_value is only meaningful when every leg is marked; otherwise
        # a missing short mark would understate (or overstate) the netting.
        cv = round(current_value, 2) if _all_marked(legs) else None
        unrealized = round(cv - net_cost, 2) if cv is not None else None

        max_profit, max_loss = _max_profit_loss(kind, name, legs, net_cost)

        strat: dict = {
            "underlying": underlying,
            "expiration": expiration,
            "kind": kind,
            "name": name,
            "dte": _dte(expiration, as_of),
            "status": "open",
            "legs": [dict(leg) for leg in legs],
            "net_cost": net_cost,
            "current_value": cv,
            "unrealized": unrealized,
            "max_profit": max_profit,
            "max_loss": max_loss,
        }
        if account is not None:
            strat["account"] = account
        strategies.append(strat)

    strategies.sort(key=lambda s: (s["underlying"], s["expiration"]))
    return strategies


# --------------------------------------------------- B. closed strategies

def _leg_summary(leg: dict, order_qty: float, multiplier: float) -> dict:
    """A compact summary of one order leg for the closed-strategy row.

    ``contracts`` = ratio_quantity × the order's spread quantity (the real
    contract count this leg transacted — the verified live butterfly has
    ratio_quantity 2 on its middle leg, so it must move 2× the wings).
    ``leg_cash`` weights the leg by its own executions × contracts × multiplier,
    signed by side (buys negative), so a caller can reconstruct per-leg P&L, not
    just the order-level net."""
    ratio = int(_f(leg.get("ratio_quantity"), 1) or 1)
    contracts = ratio * (order_qty or 0.0)
    executions = leg.get("executions") or []
    exec_qty = sum(_f(e.get("quantity")) or 0.0 for e in executions)
    exec_notional = sum((_f(e.get("quantity")) or 0.0) * (_f(e.get("price")) or 0.0)
                        for e in executions)
    exec_price = round(exec_notional / exec_qty, 6) if exec_qty > 0 else None
    side = "buy" if str(leg.get("side") or "") == "buy" else "sell"
    leg_cash = 0.0
    if exec_qty > 0:
        magnitude = exec_notional * multiplier
        leg_cash = round(-magnitude if side == "buy" else magnitude, 2)
    return {
        "side": side,
        "position_effect": str(leg.get("position_effect") or ""),
        "strike": _f(leg.get("strike_price"), None),
        "option_type": str(leg.get("option_type") or "") or None,
        "expiration": str(leg.get("expiration_date") or "") or None,
        "ratio_quantity": ratio,
        "contracts": contracts,
        "exec_price": exec_price,
        "leg_cash": leg_cash,
    }


def closed_strategies_from_orders(option_orders: list[dict]) -> list[dict]:
    """One strategy row per option ORDER (spreads are single orders at RH).

    Uses opening_strategy||closing_strategy as the name, chain_symbol as the
    underlying, direction credit/debit, and price x multiplier x quantity as the
    cash moved on the order. Realized-P&L consumers should filter state ==
    "filled"; cancelled/rejected orders are still returned WITH their state so
    the UI can render them muted.

    ``cash`` is SIGNED from the account's perspective: a filled CREDIT order is
    positive (premium received), a filled DEBIT order is negative (premium
    paid). Unfilled orders (no processed quantity) move nothing → cash 0.0.

    Each row: {order_id, underlying, name, opening_strategy, closing_strategy,
    direction, price, multiplier, quantity, cash, state, filled (bool),
    timestamp, legs: [leg summaries]}.
    """
    rows: list[dict] = []
    for order in option_orders:
        if not isinstance(order, dict):
            continue
        state = str(order.get("state") or "")
        filled = state == "filled"
        multiplier = _f(order.get("trade_value_multiplier"), 100.0) or 100.0
        direction = str(order.get("direction") or "")
        opening = order.get("opening_strategy")
        closing = order.get("closing_strategy")
        name = str(opening or closing or "option order")
        price = _f(order.get("price"), None)
        # Quantity that actually transacted (0 for a cancel with no fills).
        quantity = _f(order.get("processed_quantity")) or 0.0
        if quantity == 0:
            quantity = _f(order.get("quantity")) or 0.0

        # cash moved = price x multiplier x processed_quantity, signed by
        # direction. Only a filled order with a processed quantity moved cash.
        processed = _f(order.get("processed_quantity")) or 0.0
        cash = 0.0
        if filled and price is not None and processed > 0:
            magnitude = price * multiplier * processed
            cash = round(magnitude if direction == "credit" else -magnitude, 2)

        legs = [
            _leg_summary(leg, quantity, multiplier)
            for leg in (order.get("legs") or [])
            if isinstance(leg, dict)
        ]
        # Classify by GEOMETRY, not the broker name — RH labels every 3+ leg
        # custom order "custom". Map a leg's side/effect to the open-position
        # position_type so the shared classifier works: on an OPENING leg buy=
        # long / sell=short; on a CLOSING leg the effect inverts the exposure.
        geo_legs = []
        for ls in legs:
            opening_leg = ls["position_effect"] != "close"
            is_buy = ls["side"] == "buy"
            position_type = "long" if (is_buy == opening_leg) else "short"
            geo_legs.append({
                "option_type": ls["option_type"],
                "strike": ls["strike"],
                "expiration": ls["expiration"],
                "position_type": position_type,
                "contracts": ls["contracts"],
            })
        geo_legs.sort(key=lambda l: (_f(l.get("strike")) or 0.0,
                                     str(l.get("option_type") or "")))
        kind, structure = _classify(geo_legs) if geo_legs else ("complex", name)

        rows.append({
            "order_id": str(order.get("id") or ""),
            "underlying": str(order.get("chain_symbol") or "").upper(),
            "name": name,
            "kind": kind,
            "structure": structure,
            "opening_strategy": str(opening) if opening else None,
            "closing_strategy": str(closing) if closing else None,
            "direction": direction,
            "price": price,
            "multiplier": multiplier,
            "quantity": quantity,
            "cash": cash,
            "state": state,
            "filled": filled,
            "timestamp": str(order.get("created_at")
                             or order.get("last_transaction_at") or ""),
            "legs": legs,
        })

    rows.sort(key=lambda r: r.get("timestamp") or "", reverse=True)
    return rows


def realized_pnl_pairs(option_orders: list[dict]) -> list[dict]:
    """Best-effort open→close pairing to net realized P&L on a strategy.

    Matches a filled OPENING order (legs all position_effect "open") to a filled
    CLOSING order (all "close") on the SAME (chain_symbol, expiration set, strike
    set). When exactly one open matches exactly one close, emits a paired row
    with net_pnl = open_cash + close_cash (both signed by closed_strategies_from_
    orders' convention: credit positive, debit negative — so a debit-open /
    credit-close round trip nets naturally). Ambiguous or unmatched orders are
    left UNPAIRED and returned as-is under ``unpaired`` so nothing is invented.

    Returns {"paired": [...], "unpaired": [...]}. The API/importer currently
    surface only closed_strategies_from_orders (the per-order view); this pairing
    is offered as a helper for callers that want netted round trips.
    """
    closed = closed_strategies_from_orders(option_orders)

    def signature(row: dict) -> tuple:
        strikes = tuple(sorted(
            l["strike"] for l in row["legs"] if l["strike"] is not None))
        exps = tuple(sorted(
            l["expiration"] for l in row["legs"] if l["expiration"]))
        return (row["underlying"], exps, strikes)

    def effect(row: dict) -> str | None:
        effects = {l["position_effect"] for l in row["legs"] if l["position_effect"]}
        if effects == {"open"}:
            return "open"
        if effects == {"close"}:
            return "close"
        return None  # mixed or unknown → not pairable

    opens: dict[tuple, list[dict]] = {}
    closes: dict[tuple, list[dict]] = {}
    unpairable: list[dict] = []
    for row in closed:
        if not row["filled"]:
            unpairable.append(row)
            continue
        eff = effect(row)
        if eff == "open":
            opens.setdefault(signature(row), []).append(row)
        elif eff == "close":
            closes.setdefault(signature(row), []).append(row)
        else:
            unpairable.append(row)

    paired: list[dict] = []
    paired_ids: set[str] = set()
    for sig, open_rows in opens.items():
        close_rows = closes.get(sig, [])
        # Only pair when unambiguous: exactly one open and one close.
        if len(open_rows) == 1 and len(close_rows) == 1:
            o, c = open_rows[0], close_rows[0]
            paired.append({
                "underlying": o["underlying"],
                "name": o["name"],
                "open_order_id": o["order_id"],
                "close_order_id": c["order_id"],
                "open_cash": o["cash"],
                "close_cash": c["cash"],
                "net_pnl": round(o["cash"] + c["cash"], 2),
            })
            paired_ids.add(o["order_id"])
            paired_ids.add(c["order_id"])

    unpaired = [r for r in closed if r["order_id"] not in paired_ids]
    return {"paired": paired, "unpaired": unpaired}
