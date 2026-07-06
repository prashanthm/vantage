"""PURE covered-call / cost-reduction analyzer — the decision engine.

Encodes the user's confirmed playbook EXACTLY, applied to every open position
each night, across daily/weekly/monthly. I/O-free and fully deterministic: it
consumes an already-computed ``multi_timeframe_read`` (technicals.py), the
per-underlying position book, the equity holding, a WashStatus, and the current
price — and returns a frozen ``PositionDecision``. All disk/network/clock work
lives in analyze.py (the fetch/store/CLI layer); this module never touches any
of them.

THE THREE RULES (confirmed):

  1. STRONG ticker near support, basing (conviction label "strong" AND NOT
     broke_support_with_momentum) -> HOLD_AND_SELL_CALL. Sell a nearest-weekly
     (~7 DTE) OTM call, strike OTM and preferably AT A RESISTANCE level (from
     distance_to_resistance). Record the chosen strike, the estimated credit,
     and the resulting net-cost / basis reduction.

  2. FREE-FALL / broke support with momentum (broke_support_with_momentum True,
     OR conviction "freefall"/"weak" with price below support) ->
     CLOSE_AND_BOOK_LOSS: credit collection won't offset a structural decline.
     WASH-SALE-GATED: if the WashStatus is blocked, DO NOT recommend harvesting
     — emit HOLD_WASH_BLOCKED with the wash reason + clears_on date instead.

  3. IN BETWEEN (neutral) -> MONITOR (no action). We are deliberately
     conservative: a sell-call is only recommended on a genuinely STRONG,
     at-support, basing read (rule 1), never on a merely neutral one — see the
     MONITOR/HOLD boundary note on ``analyze_position``.

Every decision RECORDS ITS EVIDENCE: the per-timeframe trend/momentum, the S/R
levels used, the conviction score+label, which rule fired, and (for sell-call)
the strike/credit/basis math or (for close) the loss + wash status.

est_credit — the deterministic estimate. We do NOT fetch a live option chain
here (that network/auth I/O would live in analyze.py and is deliberately kept
out of the nightly path). Instead the premium is estimated from the underlying
price, the DTE, and a volatility proxy derived from the daily RSI/momentum
read, then discounted for how far OTM the chosen strike sits. Every estimated
credit is flagged ``estimated=True`` so the advisor never mistakes it for a
real quote. The analyzer takes strike candidates as an argument (the
distance_to_resistance rows), keeping it pure — a caller that later wires a
live chain simply passes real candidates + a real credit through the same door.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta


# --------------------------------------------------------------- recommendations

HOLD_AND_SELL_CALL = "HOLD_AND_SELL_CALL"
CLOSE_AND_BOOK_LOSS = "CLOSE_AND_BOOK_LOSS"
HOLD_WASH_BLOCKED = "HOLD_WASH_BLOCKED"
MONITOR = "MONITOR"

RECOMMENDATIONS = frozenset(
    {HOLD_AND_SELL_CALL, CLOSE_AND_BOOK_LOSS, HOLD_WASH_BLOCKED, MONITOR}
)


# ------------------------------------------------------------------ data shapes

@dataclass(frozen=True)
class SellCallDetail:
    """The covered-call / cost-reduction math for a HOLD_AND_SELL_CALL."""
    suggested_strike: float | None
    strike_basis: str                 # "near resistance" | "otm fallback"
    expiry_dte: int
    est_credit: float                 # dollars for the whole position's contracts
    est_credit_per_contract: float
    contracts: int
    estimated: bool                   # True: proxy estimate, not a live quote
    current_net_cost: float
    projected_net_cost: float
    basis_reduction: float            # current - projected (>= 0)
    collateral: str                   # "covered call" | "diagonal short (PMCC)"


@dataclass(frozen=True)
class CloseDetail:
    """The loss + wash reasoning for a CLOSE_AND_BOOK_LOSS / HOLD_WASH_BLOCKED."""
    unrealized_loss: float            # negative dollars (the loss being booked)
    wash_blocked: bool
    wash_reason: str | None
    wash_clears_on: str | None
    est_weekly_credit: float          # a weekly covered-call credit, for the math
    weeks_to_offset_at_est_credit: float | None  # loss / weekly credit


@dataclass(frozen=True)
class ConvictionView:
    label: str
    score: float


@dataclass(frozen=True)
class PositionDecision:
    symbol: str
    as_of: str
    current_price: float
    conviction: ConvictionView
    recommendation: str               # one of RECOMMENDATIONS
    rule: str                         # which rule fired (audit)
    rationale: str
    evidence: dict
    action_detail: dict | None = field(default=None)


# --------------------------------------------------------------- premium proxy

# A weekly (7-DTE) at-the-money call on a liquid US name typically prices near
# ~1.5% of spot; annualized that is the vol proxy floor. We scale it up when the
# daily read shows an expanding range (higher realized vol -> richer premium)
# and discount it for how far OTM the chosen strike is. Deterministic, no chain.
_BASE_WEEKLY_ATM_PCT = 0.015          # ATM 7-DTE premium as a fraction of spot
_RANGE_EXPANDING_BONUS = 1.35         # richer premium when volatility is expanding
_OTM_DECAY_PER_PCT = 0.06             # premium fraction lost per 1% OTM distance
_OTM_DECAY_FLOOR = 0.15               # never decay a strike's premium below 15%


def estimate_call_credit(
    *, current_price: float, strike: float | None, dte: int,
    range_expanding: bool, contracts: int, multiplier: float = 100.0,
) -> tuple[float, float]:
    """Deterministic per-position / per-contract credit estimate for a short
    call. Returns (total_credit, per_contract_credit) in dollars.

    premium_per_share =
        current_price
        * _BASE_WEEKLY_ATM_PCT
        * (range bonus if expanding)
        * sqrt(dte / 7)                      # time-value scales ~ sqrt(time)
        * otm_decay(strike)                  # further OTM -> cheaper, floored
    total = premium_per_share * multiplier * contracts.

    A None strike (no resistance / no OTM level found) yields a zero credit —
    there is nothing sensible to sell, and the caller records that honestly.
    """
    if strike is None or current_price <= 0 or contracts <= 0 or dte <= 0:
        return 0.0, 0.0
    atm = current_price * _BASE_WEEKLY_ATM_PCT
    if range_expanding:
        atm *= _RANGE_EXPANDING_BONUS
    time_scale = math.sqrt(dte / 7.0)
    otm_pct = max(0.0, (strike - current_price) / current_price * 100.0)
    decay = max(_OTM_DECAY_FLOOR, 1.0 - _OTM_DECAY_PER_PCT * otm_pct)
    per_share = atm * time_scale * decay
    per_contract = round(per_share * multiplier, 2)
    total = round(per_contract * contracts, 2)
    return total, per_contract


def weekly_expiry_date(today: date, dte: int) -> str:
    """The ISO date ~``dte`` days out, snapped to the next Friday (US weeklies
    expire Friday). Deterministic; used only for display in the action detail."""
    target = today + timedelta(days=dte)
    # Friday is weekday 4; roll forward to the nearest Friday on/after target.
    roll = (4 - target.weekday()) % 7
    return (target + timedelta(days=roll)).isoformat()


# ------------------------------------------------------------------- helpers

def _tf_view(tf) -> dict:
    """One TimeframeRead -> a compact JSON-safe evidence dict."""
    return {
        "trend": {
            "direction": tf.trend.direction,
            "strength": tf.trend.strength,
            "structure": tf.trend.structure,
        },
        "momentum": {
            "rsi": tf.momentum.rsi,
            "declining": tf.momentum.declining,
            "accelerating_decline": tf.momentum.accelerating_decline,
            "range_expanding": tf.momentum.range_expanding,
        },
        "support": [
            {"price": lv.price, "strength": lv.strength}
            for lv in tf.support_resistance["support"][:3]
        ],
        "resistance": [
            {"price": lv.price, "strength": lv.strength}
            for lv in tf.support_resistance["resistance"][:3]
        ],
    }


def _level(lv) -> dict | None:
    if lv is None:
        return None
    return {"price": lv.price, "strength": lv.strength, "kind": lv.kind,
            "shelf_backed": lv.shelf_backed}


def build_evidence(tech) -> dict:
    """The evidence block recorded on EVERY decision (audit trail)."""
    return {
        "per_tf": {name: _tf_view(tf) for name, tf in tech.per_tf.items()},
        "nearest_support": _level(tech.nearest_support),
        "nearest_resistance": _level(tech.nearest_resistance),
        "broke_support_with_momentum": tech.broke_support_with_momentum,
        "at_support": tech.at_support,
        "conviction": {"score": tech.conviction.score, "label": tech.conviction.label},
        "factors": dict(tech.factors),
    }


def _pick_call_strike(
    tech, current_price: float, candidates: list[dict] | None,
) -> tuple[float | None, str]:
    """Choose the covered-call strike: the NEAREST resistance ABOVE current that
    is OTM (from distance_to_resistance rows the caller passes, or the daily
    read's own resistances as a fallback). Returns (strike, basis)."""
    rows = candidates
    if rows is None:
        # Fall back to the daily read's resistance zones above current price.
        rows = [
            {"price": lv.price, "pct_away": (lv.price - current_price) / current_price * 100
             if current_price else 0.0, "strength": lv.strength}
            for lv in tech.per_tf["daily"].support_resistance["resistance"]
            if lv.price > current_price
        ]
    otm = [r for r in rows if r["price"] > current_price]
    if otm:
        otm.sort(key=lambda r: r["price"] - current_price)  # nearest resistance above
        return otm[0]["price"], "near resistance"
    return None, "otm fallback"


def _current_net_cost(ticker_book: dict | None, equity_holding: dict | None) -> float:
    """The position's current net cost (basis) in dollars.

    Prefers the option position book's signed ``net_cost`` (a debit paid to open
    the diagonal/long calls, netting any short credit already collected). Falls
    back to the equity holding's shares * avg_cost. Zero when neither is held.
    """
    if ticker_book is not None and ticker_book.get("net_cost") is not None:
        return float(ticker_book["net_cost"])
    if equity_holding is not None:
        return float(equity_holding.get("shares", 0)) * float(equity_holding.get("avg_cost", 0))
    return 0.0


def _unrealized(ticker_book: dict | None, equity_holding: dict | None,
                current_price: float) -> float:
    """Unrealized P/L in dollars: the book's ``unrealized`` (marks already
    applied by the importer) or shares * (price - avg_cost) for equity."""
    if ticker_book is not None and ticker_book.get("unrealized") is not None:
        return float(ticker_book["unrealized"])
    if equity_holding is not None:
        shares = float(equity_holding.get("shares", 0))
        return shares * (current_price - float(equity_holding.get("avg_cost", 0)))
    return 0.0


def _contracts_and_collateral(
    ticker_book: dict | None, equity_holding: dict | None,
) -> tuple[int, str]:
    """How many calls can be sold, and what collateralizes them.

    A long-dated long call (PMCC/diagonal) is collateralized by that long leg:
    one short per long call contract. >=100 shares held outright -> covered
    calls (shares // 100). We take the max sellable across both, and describe
    the dominant collateral.
    """
    long_calls = 0
    if ticker_book is not None:
        for leg in ticker_book.get("legs", []):
            if (leg.get("option_type") == "call"
                    and leg.get("position_type") == "long"):
                long_calls += int(float(leg.get("contracts", 0)))
    share_contracts = 0
    if equity_holding is not None:
        share_contracts = int(float(equity_holding.get("shares", 0)) // 100)

    if share_contracts >= long_calls and share_contracts > 0:
        return share_contracts, "covered call"
    if long_calls > 0:
        return long_calls, "diagonal short (PMCC)"
    # Nothing to collateralize a short with — advisory single contract.
    return 1, "uncovered (advisory only)"


# ------------------------------------------------------------- the analyzer

def analyze_position(
    *,
    symbol: str,
    ticker_book: dict | None,
    equity_holding: dict | None,
    current_price: float,
    tech,                              # MultiTimeframeRead
    wash,                             # WashStatus | None
    today: date,
    weekly_expiry_dte: int = 7,
    strike_candidates: list[dict] | None = None,
) -> PositionDecision:
    """Apply the playbook to ONE position. Pure — every input is passed in.

    MONITOR / HOLD boundary (documented, conservative):
      * HOLD_AND_SELL_CALL fires ONLY when conviction label == "strong" AND the
        read is at support AND NOT broke_support_with_momentum — the playbook's
        "strong ticker near support, basing" setup, and nothing weaker. Rule 1
        is where all credit-selling lives.
      * CLOSE_AND_BOOK_LOSS fires when broke_support_with_momentum is True, OR
        conviction is "freefall"/"weak" with price below the nearest support AND
        the position is at an unrealized loss — a structural decline credit
        can't offset. It is ALWAYS wash-gated: a blocked WashStatus downgrades
        it to HOLD_WASH_BLOCKED (we never harvest into a wash).
      * Everything else — neutral reads, weak-but-not-below-support, or a
        "close" trigger with NO loss to book — is MONITOR. We do NOT sell a call
        on a merely neutral read even when technically at support: the credit is
        thin and the setup unconfirmed. Conservative by design.
    """
    conviction = ConvictionView(label=tech.conviction.label, score=tech.conviction.score)
    evidence = build_evidence(tech)
    as_of = today.isoformat()

    unrealized = _unrealized(ticker_book, equity_holding, current_price)
    net_cost = _current_net_cost(ticker_book, equity_holding)
    wash_blocked = bool(wash.blocked) if wash is not None else False

    below_support = (
        tech.nearest_support is not None
        and current_price < tech.nearest_support.price
    )
    freefall = tech.broke_support_with_momentum or (
        tech.conviction.label in ("freefall", "weak") and below_support
    )

    # ---- Rule 2 / wash gate: free-fall or confirmed break with a loss ----
    if freefall and unrealized < 0:
        strike, _ = _pick_call_strike(tech, current_price, strike_candidates)
        contracts, _collateral = _contracts_and_collateral(ticker_book, equity_holding)
        weekly_total, _ = estimate_call_credit(
            current_price=current_price, strike=strike, dte=weekly_expiry_dte,
            range_expanding=tech.per_tf["daily"].momentum.range_expanding,
            contracts=max(contracts, 1),
        )
        loss = unrealized
        weeks = (abs(loss) / weekly_total) if weekly_total > 0 else None
        if wash_blocked:
            detail = CloseDetail(
                unrealized_loss=loss,
                wash_blocked=True,
                wash_reason=wash.reason,
                wash_clears_on=wash.clears_on,
                est_weekly_credit=weekly_total,
                weeks_to_offset_at_est_credit=round(weeks, 1) if weeks is not None else None,
            )
            rationale = (
                f"{symbol} broke support with momentum (conviction "
                f"{conviction.label} {conviction.score:+.2f}) and sits on an "
                f"unrealized loss of ${loss:,.0f}. Harvesting the loss is the "
                f"structural call — BUT it is WASH-BLOCKED: {wash.reason}. Do not "
                f"book the loss; hold until the wash clears "
                f"({wash.clears_on or 'unknown'})."
            )
            return PositionDecision(
                symbol=symbol, as_of=as_of, current_price=current_price,
                conviction=conviction, recommendation=HOLD_WASH_BLOCKED,
                rule="rule2_freefall_wash_blocked", rationale=rationale,
                evidence=evidence, action_detail=_close_detail_dict(detail),
            )
        detail = CloseDetail(
            unrealized_loss=loss,
            wash_blocked=False,
            wash_reason=None,
            wash_clears_on=None,
            est_weekly_credit=weekly_total,
            weeks_to_offset_at_est_credit=round(weeks, 1) if weeks is not None else None,
        )
        weeks_txt = (f"~{weeks:.0f} weeks of estimated weekly call credit "
                     f"(${weekly_total:,.0f}/wk) to offset"
                     if weeks is not None else
                     "no sensible weekly credit to offset it")
        rationale = (
            f"{symbol} broke support with momentum (conviction "
            f"{conviction.label} {conviction.score:+.2f}); the decline is "
            f"structural, not a dip. Selling calls would take {weeks_txt} the "
            f"${abs(loss):,.0f} loss — credit collection won't offset it. Book "
            f"the loss (wash-safe) and redeploy."
        )
        return PositionDecision(
            symbol=symbol, as_of=as_of, current_price=current_price,
            conviction=conviction, recommendation=CLOSE_AND_BOOK_LOSS,
            rule="rule2_freefall_close", rationale=rationale,
            evidence=evidence, action_detail=_close_detail_dict(detail),
        )

    # ---- Rule 1: strong ticker, at support, basing -> sell a call ----
    strong_at_support = (
        conviction.label == "strong"
        and tech.at_support
        and not tech.broke_support_with_momentum
    )
    if strong_at_support:
        strike, basis = _pick_call_strike(tech, current_price, strike_candidates)
        contracts, collateral = _contracts_and_collateral(ticker_book, equity_holding)
        contracts = max(contracts, 1)
        total_credit, per_contract = estimate_call_credit(
            current_price=current_price, strike=strike, dte=weekly_expiry_dte,
            range_expanding=tech.per_tf["daily"].momentum.range_expanding,
            contracts=contracts,
        )
        projected = net_cost - total_credit
        detail = SellCallDetail(
            suggested_strike=strike,
            strike_basis=basis,
            expiry_dte=weekly_expiry_dte,
            est_credit=total_credit,
            est_credit_per_contract=per_contract,
            contracts=contracts,
            estimated=True,
            current_net_cost=net_cost,
            projected_net_cost=projected,
            basis_reduction=round(net_cost - projected, 2),
            collateral=collateral,
        )
        strike_txt = f"${strike:,.2f}" if strike is not None else "no OTM level found"
        rationale = (
            f"{symbol} reads STRONG at support and basing (conviction "
            f"{conviction.score:+.2f}). Sell a ~{weekly_expiry_dte}-DTE OTM call "
            f"at {strike_txt} ({basis}) as a {collateral}: an estimated "
            f"${total_credit:,.0f} credit reduces net cost from ${net_cost:,.0f} "
            f"to ${projected:,.0f} (basis -${net_cost - projected:,.0f})."
        )
        return PositionDecision(
            symbol=symbol, as_of=as_of, current_price=current_price,
            conviction=conviction, recommendation=HOLD_AND_SELL_CALL,
            rule="rule1_strong_at_support", rationale=rationale,
            evidence=evidence, action_detail=_sell_call_detail_dict(detail),
        )

    # ---- Rule 3: everything in between -> MONITOR (no action) ----
    daily = tech.per_tf["daily"]
    rationale = (
        f"{symbol} reads {conviction.label} (conviction {conviction.score:+.2f}): "
        f"daily {daily.trend.direction}/RSI {daily.momentum.rsi:.0f}, weekly "
        f"{tech.per_tf['weekly'].trend.direction}, monthly "
        f"{tech.per_tf['monthly'].trend.direction}. Not a strong at-support "
        f"basing setup and not a confirmed momentum break with a loss to book — "
        f"monitor; take no action."
    )
    return PositionDecision(
        symbol=symbol, as_of=as_of, current_price=current_price,
        conviction=conviction, recommendation=MONITOR,
        rule="rule3_monitor", rationale=rationale,
        evidence=evidence, action_detail=None,
    )


def _sell_call_detail_dict(d: SellCallDetail) -> dict:
    return {
        "kind": "sell_call",
        "suggested_strike": d.suggested_strike,
        "strike_basis": d.strike_basis,
        "expiry_dte": d.expiry_dte,
        "est_credit": d.est_credit,
        "est_credit_per_contract": d.est_credit_per_contract,
        "contracts": d.contracts,
        "estimated": d.estimated,
        "current_net_cost": d.current_net_cost,
        "projected_net_cost": d.projected_net_cost,
        "basis_reduction": d.basis_reduction,
        "collateral": d.collateral,
    }


def _close_detail_dict(d: CloseDetail) -> dict:
    return {
        "kind": "close",
        "unrealized_loss": d.unrealized_loss,
        "wash_blocked": d.wash_blocked,
        "wash_reason": d.wash_reason,
        "wash_clears_on": d.wash_clears_on,
        "est_weekly_credit": d.est_weekly_credit,
        "weeks_to_offset_at_est_credit": d.weeks_to_offset_at_est_credit,
    }


# ------------------------------------------------------------- portfolio map

def analyze_portfolio(positions_ctx: list[dict], *, today: date) -> list[PositionDecision]:
    """Map analyze_position over a list of per-position context dicts.

    Each ctx dict: {symbol, ticker_book, equity_holding, current_price, tech,
    wash, strike_candidates?, weekly_expiry_dte?}. Returns decisions sorted by
    symbol for deterministic journaling.
    """
    out: list[PositionDecision] = []
    for ctx in positions_ctx:
        out.append(
            analyze_position(
                symbol=ctx["symbol"],
                ticker_book=ctx.get("ticker_book"),
                equity_holding=ctx.get("equity_holding"),
                current_price=ctx["current_price"],
                tech=ctx["tech"],
                wash=ctx.get("wash"),
                today=today,
                weekly_expiry_dte=ctx.get("weekly_expiry_dte", 7),
                strike_candidates=ctx.get("strike_candidates"),
            )
        )
    out.sort(key=lambda d: d.symbol)
    return out


def decision_to_dict(d: PositionDecision) -> dict:
    """A PositionDecision -> JSON-safe dict (the journal / API / MCP shape)."""
    return {
        "symbol": d.symbol,
        "as_of": d.as_of,
        "current_price": d.current_price,
        "conviction": {"label": d.conviction.label, "score": d.conviction.score},
        "recommendation": d.recommendation,
        "rule": d.rule,
        "rationale": d.rationale,
        "evidence": d.evidence,
        "action_detail": d.action_detail,
    }
