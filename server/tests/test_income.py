"""The PURE analyzer's trust surface — canned tech reads + position inputs,
one assertion per rule. Fully deterministic, offline: no bars, no disk, no
network. Every MultiTimeframeRead is hand-built so the rule under test fires
unambiguously."""
from __future__ import annotations

import datetime as _dt

import pytest

from vantage_server import income
from vantage_server.models import WashStatus
from vantage_server.technicals import (
    Conviction,
    Level,
    Momentum,
    MultiTimeframeRead,
    TimeframeRead,
    Trend,
)

TODAY = _dt.date(2026, 7, 5)


# ------------------------------------------------------------- tech builders

def _tf(direction="sideways", rsi=50.0, declining=False, accelerating=False,
        expanding=False, structure="mixed", support=None, resistance=None):
    return TimeframeRead(
        trend=Trend(direction=direction, strength=0.5, structure=structure),
        momentum=Momentum(rsi=rsi, declining=declining,
                          accelerating_decline=accelerating, range_expanding=expanding),
        support_resistance={
            "support": support or [],
            "resistance": resistance or [],
        },
    )


def _level(price, kind, strength=3.0):
    return Level(price=price, strength=strength, kind=kind, pivots=int(strength),
                 shelf_backed=strength > 2)


def _mtr(*, per_tf, nearest_support=None, nearest_resistance=None,
         broke=False, conviction, at_support=False, factors=None):
    return MultiTimeframeRead(
        per_tf=per_tf,
        nearest_support=nearest_support,
        nearest_resistance=nearest_resistance,
        broke_support_with_momentum=broke,
        conviction=conviction,
        at_support=at_support,
        factors=factors or {},
    )


# =========================================================== rule 1: sell call

def test_strong_at_support_sells_a_call_at_resistance():
    support = _level(98.0, "support")
    resistance = _level(110.0, "resistance", strength=4.0)
    daily = _tf(direction="sideways", rsi=52.0, support=[support],
                resistance=[resistance])
    tech = _mtr(
        per_tf={"daily": daily, "weekly": _tf(), "monthly": _tf()},
        nearest_support=support, nearest_resistance=resistance,
        conviction=Conviction(score=0.9, label="strong"), at_support=True,
    )
    # A PMCC diagonal: one long call collateralizes the short.
    book = {"underlying": "STRONG", "net_cost": 3000.0, "unrealized": -100.0,
            "legs": [{"option_type": "call", "position_type": "long", "contracts": 1}]}

    d = income.analyze_position(
        symbol="STRONG", ticker_book=book, equity_holding=None,
        current_price=100.0, tech=tech, wash=WashStatus(symbol="STRONG", blocked=False),
        today=TODAY,
        strike_candidates=[{"price": 110.0, "pct_away": 10.0, "strength": 4.0}],
    )

    assert d.recommendation == income.HOLD_AND_SELL_CALL
    assert d.rule == "rule1_strong_at_support"
    detail = d.action_detail
    assert detail["kind"] == "sell_call"
    # strike is a resistance level ABOVE current
    assert detail["suggested_strike"] == 110.0
    assert detail["strike_basis"] == "near resistance"
    assert detail["est_credit"] > 0
    assert detail["estimated"] is True
    # projected net cost is REDUCED by the credit
    assert detail["projected_net_cost"] < detail["current_net_cost"]
    assert detail["basis_reduction"] == pytest.approx(
        detail["current_net_cost"] - detail["projected_net_cost"])


def test_strong_covered_call_uses_share_lots_when_100_plus_shares():
    support = _level(48.0, "support")
    resistance = _level(55.0, "resistance")
    daily = _tf(rsi=55.0, support=[support], resistance=[resistance])
    tech = _mtr(per_tf={"daily": daily, "weekly": _tf(), "monthly": _tf()},
                nearest_support=support, nearest_resistance=resistance,
                conviction=Conviction(score=0.7, label="strong"), at_support=True)
    holding = {"shares": 200.0, "avg_cost": 50.0}  # 2 covered calls

    d = income.analyze_position(
        symbol="EQ", ticker_book=None, equity_holding=holding,
        current_price=50.0, tech=tech, wash=WashStatus(symbol="EQ", blocked=False),
        today=TODAY,
        strike_candidates=[{"price": 55.0, "pct_away": 10.0, "strength": 3.0}])

    assert d.recommendation == income.HOLD_AND_SELL_CALL
    assert d.action_detail["collateral"] == "covered call"
    assert d.action_detail["contracts"] == 2
    assert d.action_detail["current_net_cost"] == pytest.approx(10000.0)


# =========================================================== rule 2: close/wash

def _freefall_tech(current_below=90.0):
    support = _level(100.0, "support")   # price BELOW this support
    daily = _tf(direction="down", rsi=28.0, declining=True, accelerating=True,
                expanding=True, structure="LH-LL", support=[support])
    return _mtr(
        per_tf={"daily": daily,
                "weekly": _tf(direction="down"),
                "monthly": _tf(direction="down")},
        nearest_support=support,
        conviction=Conviction(score=-1.0, label="freefall"),
        broke=True,
    )


def test_freefall_with_loss_and_no_wash_closes_and_books_loss():
    tech = _freefall_tech()
    book = {"underlying": "FALL", "net_cost": 2000.0, "unrealized": -1200.0,
            "legs": [{"option_type": "call", "position_type": "long", "contracts": 1}]}

    d = income.analyze_position(
        symbol="FALL", ticker_book=book, equity_holding=None,
        current_price=90.0, tech=tech, wash=WashStatus(symbol="FALL", blocked=False),
        today=TODAY,
        strike_candidates=[{"price": 100.0, "pct_away": 11.0, "strength": 3.0}])

    assert d.recommendation == income.CLOSE_AND_BOOK_LOSS
    assert d.rule == "rule2_freefall_close"
    detail = d.action_detail
    assert detail["kind"] == "close"
    assert detail["unrealized_loss"] == -1200.0
    assert detail["wash_blocked"] is False
    # the "credit won't offset" math is computed
    assert detail["weeks_to_offset_at_est_credit"] is not None
    assert detail["weeks_to_offset_at_est_credit"] > 0


def test_freefall_with_loss_but_wash_blocked_never_harvests():
    """CRITICAL: a wash-blocked symbol must NEVER get a CLOSE recommendation."""
    tech = _freefall_tech()
    book = {"underlying": "WASHY", "net_cost": 2000.0, "unrealized": -900.0,
            "legs": [{"option_type": "call", "position_type": "long", "contracts": 1}]}
    wash = WashStatus(
        symbol="WASHY", blocked=True,
        reason="RH-Roth bought WASHY on Jun 20 (DCA)",
        clears_on="Jul 21", clears_on_date="2026-07-21",
    )

    d = income.analyze_position(
        symbol="WASHY", ticker_book=book, equity_holding=None,
        current_price=90.0, tech=tech, wash=wash, today=TODAY,
        strike_candidates=[{"price": 100.0, "pct_away": 11.0, "strength": 3.0}])

    assert d.recommendation == income.HOLD_WASH_BLOCKED
    assert d.recommendation != income.CLOSE_AND_BOOK_LOSS
    assert d.rule == "rule2_freefall_wash_blocked"
    detail = d.action_detail
    assert detail["kind"] == "close"
    assert detail["wash_blocked"] is True
    assert detail["wash_reason"] == "RH-Roth bought WASHY on Jun 20 (DCA)"
    assert detail["wash_clears_on"] == "Jul 21"
    # the wash reason is surfaced in the human rationale too
    assert "WASH-BLOCKED" in d.rationale
    assert "Jul 21" in d.rationale


def test_freefall_but_no_loss_does_not_close():
    """A momentum break with the position in PROFIT has no loss to book -> not
    a close; falls through to MONITOR."""
    tech = _freefall_tech()
    book = {"underlying": "UP", "net_cost": 2000.0, "unrealized": 300.0, "legs": []}

    d = income.analyze_position(
        symbol="UP", ticker_book=book, equity_holding=None,
        current_price=90.0, tech=tech, wash=WashStatus(symbol="UP", blocked=False),
        today=TODAY)
    assert d.recommendation == income.MONITOR


# =============================================================== rule 3: monitor

def test_neutral_monitors():
    support = _level(95.0, "support")
    daily = _tf(direction="sideways", rsi=48.0, support=[support])
    tech = _mtr(
        per_tf={"daily": daily, "weekly": _tf(), "monthly": _tf(direction="down")},
        nearest_support=support,
        conviction=Conviction(score=-0.2, label="neutral"),
        at_support=False,
    )
    d = income.analyze_position(
        symbol="MEH", ticker_book={"net_cost": 1000.0, "unrealized": -50.0, "legs": []},
        equity_holding=None, current_price=100.0, tech=tech,
        wash=WashStatus(symbol="MEH", blocked=False), today=TODAY)

    assert d.recommendation == income.MONITOR
    assert d.rule == "rule3_monitor"
    assert d.action_detail is None


def test_weak_but_above_support_monitors_not_closes():
    """Weak conviction but price still ABOVE support and no confirmed break ->
    not a structural free-fall; conservative MONITOR."""
    support = _level(90.0, "support")
    daily = _tf(direction="down", rsi=42.0, declining=True, support=[support])
    tech = _mtr(
        per_tf={"daily": daily, "weekly": _tf(direction="down"),
                "monthly": _tf(direction="down")},
        nearest_support=support,
        conviction=Conviction(score=-0.6, label="weak"),
        broke=False,  # not a confirmed momentum break
    )
    # current_price 100 is ABOVE support 90 -> below_support is False
    d = income.analyze_position(
        symbol="SOFT", ticker_book={"net_cost": 1000.0, "unrealized": -200.0, "legs": []},
        equity_holding=None, current_price=100.0, tech=tech,
        wash=WashStatus(symbol="SOFT", blocked=False), today=TODAY)
    assert d.recommendation == income.MONITOR


# =============================================================== evidence block

@pytest.mark.parametrize("builder,price,wash", [
    ("strong", 100.0, WashStatus(symbol="X", blocked=False)),
    ("freefall", 90.0, WashStatus(symbol="X", blocked=False)),
    ("neutral", 100.0, WashStatus(symbol="X", blocked=False)),
])
def test_evidence_block_always_populated(builder, price, wash):
    if builder == "strong":
        support = _level(98.0, "support")
        daily = _tf(rsi=52.0, support=[support], resistance=[_level(110.0, "resistance")])
        tech = _mtr(per_tf={"daily": daily, "weekly": _tf(), "monthly": _tf()},
                    nearest_support=support, nearest_resistance=_level(110.0, "resistance"),
                    conviction=Conviction(score=0.9, label="strong"), at_support=True,
                    factors={"at_support": True, "basing": True})
    elif builder == "freefall":
        tech = _freefall_tech()
        object.__setattr__(tech, "factors", {"broke_support_with_momentum": True})
    else:
        support = _level(95.0, "support")
        tech = _mtr(per_tf={"daily": _tf(support=[support]), "weekly": _tf(),
                            "monthly": _tf()},
                    nearest_support=support,
                    conviction=Conviction(score=0.0, label="neutral"),
                    factors={"basing": True})

    d = income.analyze_position(
        symbol="X", ticker_book={"net_cost": 1000.0, "unrealized": -100.0, "legs": []},
        equity_holding=None, current_price=price, tech=tech, wash=wash, today=TODAY)

    ev = d.evidence
    assert set(ev["per_tf"]) == {"daily", "weekly", "monthly"}
    for tf in ev["per_tf"].values():
        assert "trend" in tf and "momentum" in tf
        assert "support" in tf and "resistance" in tf
    assert "conviction" in ev and ev["conviction"]["label"]
    assert "nearest_support" in ev
    assert "broke_support_with_momentum" in ev
    assert "factors" in ev
    # conviction view is always present on the decision
    assert d.conviction.label
    assert isinstance(d.conviction.score, float)


# =============================================================== portfolio map

def test_analyze_portfolio_maps_and_sorts():
    support = _level(98.0, "support")
    strong = _mtr(per_tf={"daily": _tf(rsi=52.0, support=[support]),
                          "weekly": _tf(), "monthly": _tf()},
                  nearest_support=support,
                  conviction=Conviction(score=0.9, label="strong"), at_support=True)
    neutral = _mtr(per_tf={"daily": _tf(), "weekly": _tf(), "monthly": _tf()},
                   conviction=Conviction(score=0.0, label="neutral"))
    ctxs = [
        {"symbol": "ZZZ", "ticker_book": {"net_cost": 1.0, "unrealized": 0.0, "legs": []},
         "current_price": 100.0, "tech": neutral, "wash": None},
        {"symbol": "AAA", "ticker_book": {"net_cost": 1.0, "unrealized": 0.0, "legs": []},
         "current_price": 100.0, "tech": strong, "wash": None,
         "strike_candidates": [{"price": 110.0, "pct_away": 10.0, "strength": 3.0}]},
    ]
    out = income.analyze_portfolio(ctxs, today=TODAY)
    assert [d.symbol for d in out] == ["AAA", "ZZZ"]  # sorted
    assert out[0].recommendation == income.HOLD_AND_SELL_CALL
    assert out[1].recommendation == income.MONITOR


# ==================================================== per-option-leg strategist

def _leg(strike, exp_days, option_type="call", position_type="long", contracts=1,
         avg_price=5.0, mark=None):
    """One open option leg dict (broker-normalized shape) expiring exp_days out."""
    exp = (TODAY + _dt.timedelta(days=exp_days)).isoformat()
    leg = {"underlying": "X", "expiration": exp, "strike": float(strike),
           "option_type": option_type, "position_type": position_type,
           "contracts": float(contracts), "avg_price": avg_price,
           "occ_symbol": f"X {exp} {int(strike)}{option_type[0].upper()}"}
    if mark is not None:
        leg["mark"] = mark
    return leg


def _book(legs, **extra):
    return {"underlying": "X", "status": "open", "legs": legs, **extra}


def _neutral_tech(support=None, resistance=None, direction="sideways", broke=False,
                  label="neutral"):
    daily = _tf(direction=direction, support=support or [], resistance=resistance or [])
    return _mtr(per_tf={"daily": daily, "weekly": _tf(), "monthly": _tf()},
                nearest_support=(support or [None])[0],
                nearest_resistance=(resistance or [None])[0],
                broke=broke, conviction=Conviction(score=0.0, label=label))


def _actions(book, tech, price):
    return income.analyze_option_legs(book, tech=tech, current_price=price,
                                      today=TODAY, symbol="X")


def test_near_expiry_itm_long_take_profit():
    # long $90C, price $110 (ITM), 3 DTE -> TAKE_PROFIT
    book = _book([_leg(90, 3)])
    acts = _actions(book, _neutral_tech(), 110.0)
    assert len(acts) == 1
    assert acts[0]["action"] == income.TAKE_PROFIT
    assert acts[0]["moneyness"] == "ITM" and acts[0]["dte"] == 3


def test_near_expiry_otm_long_let_expire():
    # long $130C, price $110 (OTM), 4 DTE -> LET_EXPIRE
    acts = _actions(_book([_leg(130, 4)]), _neutral_tech(), 110.0)
    assert acts[0]["action"] == income.LET_EXPIRE


def test_near_expiry_atm_long_roll_out():
    # long $110C, price $110 (ATM), 5 DTE -> ROLL_OUT with an expiry target
    acts = _actions(_book([_leg(110, 5)]), _neutral_tech(), 110.0)
    assert acts[0]["action"] == income.ROLL_OUT
    assert acts[0]["target"] and acts[0]["target"].get("expiry")


def test_short_leg_at_strike_defends():
    # short $130C, price $131 (through strike) -> DEFEND, assignment_risk
    resistance = _level(140.0, "resistance")
    tech = _neutral_tech(resistance=[resistance])
    acts = _actions(_book([_leg(130, 100, position_type="short")]), tech, 131.0)
    assert acts[0]["action"] == income.DEFEND
    assert acts[0]["assignment_risk"] is True
    # roll target snaps to the resistance level
    assert acts[0]["target"] and acts[0]["target"].get("strike") == 140.0


def test_short_leg_comfortably_otm_holds():
    # short $130C, price $110 -> HOLD_LEG (not threatened)
    acts = _actions(_book([_leg(130, 100, position_type="short")]), _neutral_tech(), 110.0)
    assert acts[0]["action"] == income.HOLD_LEG
    assert acts[0]["assignment_risk"] is False


def test_long_leg_freefall_closes():
    # underlying broke support with momentum -> CLOSE_LEG on the long call
    tech = _neutral_tech(broke=True, label="freefall")
    acts = _actions(_book([_leg(90, 200)]), tech, 80.0)
    assert acts[0]["action"] == income.CLOSE_LEG


def test_long_leg_otm_loser_rolls_down_to_support():
    # OTM long at a loss (mark < avg), underlying not uptrending, support below
    support = _level(95.0, "support")
    tech = _neutral_tech(support=[support], direction="sideways")
    leg = _leg(120, 200, avg_price=6.0, mark=3.0)  # underwater
    acts = _actions(_book([leg]), tech, 100.0)
    assert acts[0]["action"] == income.ROLL_DOWN
    assert acts[0]["target"]["strike"] == 95.0


def test_long_leg_default_holds():
    # comfortable long LEAP, nothing triggered -> HOLD_LEG
    acts = _actions(_book([_leg(120, 400)]), _neutral_tech(), 100.0)
    assert acts[0]["action"] == income.HOLD_LEG


def test_unmarked_leg_still_gets_an_action():
    # no mark present -> no crash; near-expiry OTM still LET_EXPIRE
    leg = _leg(130, 4, mark=None)
    acts = _actions(_book([leg]), _neutral_tech(), 110.0)
    assert acts and acts[0]["action"] == income.LET_EXPIRE


def test_equity_only_has_no_leg_actions():
    assert income.analyze_option_legs(None, tech=_neutral_tech(),
                                      current_price=100.0, today=TODAY, symbol="X") == []
    assert _actions(_book([]), _neutral_tech(), 100.0) == []


def test_leg_actions_flow_onto_the_decision():
    # analyze_position attaches leg_actions and decision_to_dict serializes them.
    book = _book([_leg(130, 4)], net_cost=500.0, unrealized=-50.0)
    d = income.analyze_position(
        symbol="X", ticker_book=book, equity_holding=None, current_price=110.0,
        tech=_neutral_tech(), wash=None, today=TODAY,
    )
    assert len(d.leg_actions) == 1
    payload = income.decision_to_dict(d)
    assert payload["leg_actions"][0]["action"] == income.LET_EXPIRE
