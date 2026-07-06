"""Options STRATEGY roll-up engine (pure, no I/O): the open-position
classification matrix (single / vertical debit+credit / both-long multi-leg /
butterfly / iron condor / complex), signed net_cost + current_value +
unrealized, and the closed per-ORDER roll-up over canned option orders (one row
per order, direction, signed cash, state, geometry-classified 'custom' orders).
"""
from __future__ import annotations

import pytest

from vantage_server.strategies import (
    closed_strategies_from_orders,
    group_open_strategies,
    realized_pnl_pairs,
)

AS_OF = "2026-07-05"


def _leg(underlying, expiration, strike, option_type, position_type,
         contracts=1.0, avg_price=0.0, mark=None, multiplier=100.0):
    """Build one normalized open option-position leg (fetch_option_positions
    shape). avg_price / mark are PER-SHARE."""
    leg = {
        "underlying": underlying, "expiration": expiration, "strike": strike,
        "option_type": option_type, "position_type": position_type,
        "contracts": contracts, "avg_price": avg_price, "multiplier": multiplier,
    }
    if mark is not None:
        leg["mark"] = mark
    return leg


# ------------------------------------------------- open classification matrix

def _one(strats):
    assert len(strats) == 1, [s["name"] for s in strats]
    return strats[0]


def test_single_leg():
    s = _one(group_open_strategies(
        [_leg("PLTR", "2026-08-21", 120, "put", "short",
              contracts=2, avg_price=3.0, mark=2.0)], as_of=AS_OF))
    assert s["kind"] == "single"
    assert s["name"] == "short put"
    # short: net_cost is a credit (negative). cost = 3*2*100 = 600 received.
    assert s["net_cost"] == pytest.approx(-600.0)
    # current_value = -(short mark) = -(2*2*100) = -400
    assert s["current_value"] == pytest.approx(-400.0)
    assert s["unrealized"] == pytest.approx(200.0)  # -400 - (-600)
    assert s["max_profit"] is None and s["max_loss"] is None


def test_bull_call_debit_spread():
    # long 120C + short 130C, debit
    legs = [
        _leg("PLTR", "2026-08-21", 120, "call", "long", avg_price=6.0, mark=7.0),
        _leg("PLTR", "2026-08-21", 130, "call", "short", avg_price=2.0, mark=2.5),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["kind"] == "vertical"
    assert s["name"] == "bull call (debit) spread"
    # net_cost = long 6*100 - short 2*100 = 400 debit (positive)
    assert s["net_cost"] == pytest.approx(400.0)
    # current_value = long mark 700 - short mark 250 = 450
    assert s["current_value"] == pytest.approx(450.0)
    assert s["unrealized"] == pytest.approx(50.0)
    # width = 10 * 1 * 100 = 1000; max_loss = debit = 400, max_profit = 600
    assert s["max_loss"] == pytest.approx(400.0)
    assert s["max_profit"] == pytest.approx(600.0)


def test_bear_call_credit_spread():
    # short lower 100C + long higher 110C, credit
    legs = [
        _leg("SPY", "2026-08-21", 100, "call", "short", avg_price=5.0, mark=4.0),
        _leg("SPY", "2026-08-21", 110, "call", "long", avg_price=2.0, mark=1.5),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["name"] == "bear call (credit) spread"
    # net_cost = long 2*100 - short 5*100 = -300 (credit received)
    assert s["net_cost"] == pytest.approx(-300.0)
    # width 10*100 = 1000; credit 300 -> max_profit 300, max_loss 700
    assert s["max_profit"] == pytest.approx(300.0)
    assert s["max_loss"] == pytest.approx(700.0)


def test_bull_put_credit_spread():
    # long lower 90P + short higher 100P, credit
    legs = [
        _leg("QQQ", "2026-08-21", 90, "put", "long", avg_price=1.0, mark=0.8),
        _leg("QQQ", "2026-08-21", 100, "put", "short", avg_price=4.0, mark=3.0),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["name"] == "bull put (credit) spread"
    assert s["net_cost"] == pytest.approx(-300.0)  # 100 - 400
    assert s["max_profit"] == pytest.approx(300.0)


def test_bear_put_debit_spread():
    # long higher 100P + short lower 90P, debit
    legs = [
        _leg("IWM", "2026-08-21", 100, "put", "long", avg_price=5.0, mark=6.0),
        _leg("IWM", "2026-08-21", 90, "put", "short", avg_price=2.0, mark=2.0),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["name"] == "bear put (debit) spread"
    assert s["net_cost"] == pytest.approx(300.0)  # debit
    assert s["max_loss"] == pytest.approx(300.0)


def test_both_long_same_type_is_multi_leg():
    # The real FISV 50C + 60C both-long case: not a vertical, don't over-classify
    legs = [
        _leg("FISV", "2026-08-21", 50, "call", "long", avg_price=8.0, mark=9.0),
        _leg("FISV", "2026-08-21", 60, "call", "long", avg_price=3.0, mark=3.5),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["kind"] == "multi-leg"
    assert s["name"] == "multi-leg (call)"
    # both long: net_cost = (8+3)*100 = 1100, current = (9+3.5)*100 = 1250
    assert s["net_cost"] == pytest.approx(1100.0)
    assert s["current_value"] == pytest.approx(1250.0)
    assert s["unrealized"] == pytest.approx(150.0)
    assert s["max_profit"] is None and s["max_loss"] is None


def test_long_call_butterfly_by_geometry_and_ratio():
    # buy 1x 100C, sell 2x 110C, buy 1x 120C -> long call butterfly.
    # The middle leg has contracts=2 (ratio honored in the net math).
    legs = [
        _leg("XYZ", "2026-08-21", 100, "call", "long", contracts=1, avg_price=5.0, mark=6.0),
        _leg("XYZ", "2026-08-21", 110, "call", "short", contracts=2, avg_price=2.0, mark=2.5),
        _leg("XYZ", "2026-08-21", 120, "call", "long", contracts=1, avg_price=1.0, mark=1.2),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["kind"] == "butterfly"
    assert s["name"] == "long call butterfly"
    # net_cost = long(5*1 + 1*1)*100 - short(2*2)*100 = 600 - 400 = 200
    assert s["net_cost"] == pytest.approx(200.0)
    # current = (6*1 + 1.2*1)*100 - (2.5*2)*100 = 720 - 500 = 220
    assert s["current_value"] == pytest.approx(220.0)
    assert s["unrealized"] == pytest.approx(20.0)


def test_iron_condor_by_geometry():
    # 4 legs: put spread (long 90 / short 95) + call spread (short 105 / long 110)
    legs = [
        _leg("SPX", "2026-08-21", 90, "put", "long", avg_price=1.0, mark=0.8),
        _leg("SPX", "2026-08-21", 95, "put", "short", avg_price=3.0, mark=2.0),
        _leg("SPX", "2026-08-21", 105, "call", "short", avg_price=3.0, mark=2.0),
        _leg("SPX", "2026-08-21", 110, "call", "long", avg_price=1.0, mark=0.8),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["kind"] == "iron"
    assert s["name"] == "iron condor"
    # net_cost = long(1+1)*100 - short(3+3)*100 = 200 - 600 = -400 credit
    assert s["net_cost"] == pytest.approx(-400.0)


def test_complex_three_leg_fallback_still_priced():
    # 3 legs that are NOT a 1-2-1 butterfly -> complex, but math must be right
    legs = [
        _leg("ABC", "2026-08-21", 100, "call", "long", contracts=1, avg_price=5.0, mark=6.0),
        _leg("ABC", "2026-08-21", 110, "call", "short", contracts=1, avg_price=2.0, mark=2.0),
        _leg("ABC", "2026-08-21", 120, "call", "short", contracts=1, avg_price=1.0, mark=1.0),
    ]
    s = _one(group_open_strategies(legs, as_of=AS_OF))
    assert s["kind"] == "complex"
    assert s["name"] == "complex (3 legs)"
    # net_cost = 5*100 - (2+1)*100 = 200
    assert s["net_cost"] == pytest.approx(200.0)
    assert s["current_value"] == pytest.approx(600.0 - 300.0)
    assert len(s["legs"]) == 3  # never dropped


def test_calendar_splits_in_open_view_by_expiration_grouping():
    # Open positions group by (underlying, expiration), so a calendar's two
    # legs land in SEPARATE groups (each a single) — calendar detection is only
    # meaningful for closed ORDERS, where one order holds legs across expiries.
    legs = [
        _leg("MSFT", "2026-07-17", 400, "call", "short", avg_price=5.0, mark=4.0),
        _leg("MSFT", "2026-08-21", 400, "call", "long", avg_price=8.0, mark=8.0),
    ]
    strats = group_open_strategies(legs, as_of=AS_OF)
    assert len(strats) == 2
    assert {s["kind"] for s in strats} == {"single"}


def test_calendar_diagonal_from_closed_order_geometry():
    # A closed order whose legs span two expirations, same type opposite sides.
    order = {
        "id": "cal", "chain_symbol": "MSFT", "state": "filled", "direction": "debit",
        "quantity": "1", "processed_quantity": "1", "price": "3.0",
        "trade_value_multiplier": "100.0000", "opening_strategy": "custom",
        "created_at": "2026-07-01T10:00:00Z",
        "legs": [
            {"side": "sell", "position_effect": "open", "ratio_quantity": 1,
             "strike_price": "400.0", "expiration_date": "2026-07-17",
             "option_type": "call", "executions": [{"price": "5", "quantity": "1"}]},
            {"side": "buy", "position_effect": "open", "ratio_quantity": 1,
             "strike_price": "400.0", "expiration_date": "2026-08-21",
             "option_type": "call", "executions": [{"price": "8", "quantity": "1"}]},
        ]}
    row = closed_strategies_from_orders([order])[0]
    assert row["kind"] == "calendar"
    assert row["structure"] == "calendar/diagonal (call)"


def test_dte_and_grouping_and_unmarked_current_value():
    # two distinct (underlying, expiration) groups + one leg missing a mark
    legs = [
        _leg("AAA", "2026-07-15", 10, "call", "long", avg_price=1.0, mark=1.5),
        _leg("BBB", "2026-07-25", 20, "put", "long", avg_price=2.0),  # no mark
    ]
    strats = group_open_strategies(legs, as_of=AS_OF)
    assert [s["underlying"] for s in strats] == ["AAA", "BBB"]  # sorted
    aaa = strats[0]
    assert aaa["dte"] == 10  # 2026-07-15 - 2026-07-05
    bbb = strats[1]
    # unmarked leg -> current_value/unrealized are None (honest)
    assert bbb["current_value"] is None
    assert bbb["unrealized"] is None
    assert bbb["net_cost"] == pytest.approx(200.0)


def test_short_legs_are_included_unlike_lots_view():
    # A pure short position IS represented here (contrast: the lots importer
    # skips shorts because the engine rejects negative shares).
    strats = group_open_strategies(
        [_leg("TSLA", "2026-08-21", 300, "call", "short", avg_price=10.0, mark=9.0)],
        as_of=AS_OF)
    assert len(strats) == 1
    assert strats[0]["legs"][0]["position_type"] == "short"


# ------------------------------------------------- closed per-order roll-up

CANNED_ORDERS = [
    # filled 2-leg credit spread (SPXW-style)
    {"id": "oo-1", "chain_symbol": "SPXW", "state": "filled", "type": "limit",
     "direction": "credit", "quantity": "2.00000", "processed_quantity": "2.00000",
     "price": "1.50000000", "trade_value_multiplier": "100.0000",
     "opening_strategy": "short_call_spread", "closing_strategy": None,
     "created_at": "2026-07-02T19:40:00Z",
     "legs": [
         {"side": "sell", "position_effect": "open", "ratio_quantity": 1,
          "strike_price": "7465.0000", "expiration_date": "2026-07-02",
          "option_type": "call",
          "executions": [{"price": "1.72", "quantity": "2.0"}]},
         {"side": "buy", "position_effect": "open", "ratio_quantity": 1,
          "strike_price": "7490.0000", "expiration_date": "2026-07-02",
          "option_type": "call",
          "executions": [{"price": "0.22", "quantity": "2.0"}]},
     ]},
    # cancelled order -> nothing moved, still surfaced with state
    {"id": "oo-2", "chain_symbol": "SNK", "state": "cancelled", "type": "limit",
     "direction": "credit", "quantity": "1.00000", "processed_quantity": "0.00000",
     "price": "2.50000000", "trade_value_multiplier": "100.0000",
     "opening_strategy": None, "closing_strategy": "short_call",
     "created_at": "2026-06-22T14:00:00Z",
     "legs": [
         {"side": "sell", "position_effect": "close", "ratio_quantity": 1,
          "strike_price": "15.0000", "expiration_date": "2026-07-17",
          "option_type": "call"},
     ]},
    # a real "custom" 3-leg butterfly: sell 2x mid, buy 1x low, buy 1x high
    {"id": "oo-3", "chain_symbol": "SPXW", "state": "filled", "type": "limit",
     "direction": "debit", "quantity": "1.00000", "processed_quantity": "1.00000",
     "price": "0.50000000", "trade_value_multiplier": "100.0000",
     "opening_strategy": "custom", "closing_strategy": None,
     "created_at": "2026-07-03T15:00:00Z",
     "legs": [
         {"side": "buy", "position_effect": "open", "ratio_quantity": 1,
          "strike_price": "7470.0000", "expiration_date": "2026-07-03",
          "option_type": "call",
          "executions": [{"price": "5.0", "quantity": "1.0"}]},
         {"side": "sell", "position_effect": "open", "ratio_quantity": 2,
          "strike_price": "7485.0000", "expiration_date": "2026-07-03",
          "option_type": "call",
          "executions": [{"price": "2.0", "quantity": "2.0"}]},
         {"side": "buy", "position_effect": "open", "ratio_quantity": 1,
          "strike_price": "7500.0000", "expiration_date": "2026-07-03",
          "option_type": "call",
          "executions": [{"price": "1.0", "quantity": "1.0"}]},
     ]},
]


def test_closed_one_row_per_order_direction_cash_state():
    rows = closed_strategies_from_orders(CANNED_ORDERS)
    assert len(rows) == 3  # one row per ORDER, spreads not split
    by_id = {r["order_id"]: r for r in rows}

    credit = by_id["oo-1"]
    assert credit["direction"] == "credit"
    assert credit["state"] == "filled" and credit["filled"] is True
    # cash = +price * multiplier * processed_qty = 1.5 * 100 * 2 = +300 (credit)
    assert credit["cash"] == pytest.approx(300.0)
    assert credit["kind"] == "vertical"  # geometry recognizes it despite name
    assert len(credit["legs"]) == 2

    cancelled = by_id["oo-2"]
    assert cancelled["state"] == "cancelled" and cancelled["filled"] is False
    assert cancelled["cash"] == 0.0  # nothing moved

    # newest first
    assert [r["order_id"] for r in rows] == sorted(
        (r["order_id"] for r in rows),
        key=lambda oid: by_id[oid]["timestamp"], reverse=True)


def test_closed_custom_butterfly_classified_by_geometry_with_ratio():
    rows = closed_strategies_from_orders(CANNED_ORDERS)
    bf = next(r for r in rows if r["order_id"] == "oo-3")
    # RH called it "custom"; we classify from geometry.
    assert bf["name"] == "custom"           # broker name preserved
    assert bf["kind"] == "butterfly"        # our geometry classification
    assert bf["structure"] == "long call butterfly"
    # middle leg ratio_quantity=2 honored -> contracts = 2 * order_qty(1) = 2
    mid = next(l for l in bf["legs"] if l["strike"] == 7485.0)
    assert mid["ratio_quantity"] == 2
    assert mid["contracts"] == pytest.approx(2.0)
    # debit order cash negative: 0.5 * 100 * 1 = -50
    assert bf["cash"] == pytest.approx(-50.0)


def test_closed_tolerates_non_dict_and_empty_legs():
    rows = closed_strategies_from_orders(
        [{"id": "x", "chain_symbol": "Q", "state": "rejected", "legs": []},
         "garbage"])  # non-dict ignored
    assert len(rows) == 1
    assert rows[0]["kind"] == "complex"  # no legs -> complex fallback
    assert rows[0]["legs"] == []


def test_realized_pnl_pairs_leaves_unpaired_when_no_match():
    # All openings, no matching close -> everything unpaired, nothing invented
    result = realized_pnl_pairs(CANNED_ORDERS)
    assert result["paired"] == []
    assert len(result["unpaired"]) == 3


def test_realized_pnl_pairs_nets_a_matched_round_trip():
    open_order = {
        "id": "open", "chain_symbol": "AAA", "state": "filled",
        "direction": "debit", "quantity": "1", "processed_quantity": "1",
        "price": "2.00", "trade_value_multiplier": "100.0000",
        "opening_strategy": "long_call_spread", "created_at": "2026-06-01T10:00:00Z",
        "legs": [
            {"side": "buy", "position_effect": "open", "ratio_quantity": 1,
             "strike_price": "100.0", "expiration_date": "2026-07-17",
             "option_type": "call", "executions": [{"price": "2", "quantity": "1"}]},
            {"side": "sell", "position_effect": "open", "ratio_quantity": 1,
             "strike_price": "110.0", "expiration_date": "2026-07-17",
             "option_type": "call", "executions": [{"price": "0", "quantity": "1"}]},
        ]}
    close_order = {
        "id": "close", "chain_symbol": "AAA", "state": "filled",
        "direction": "credit", "quantity": "1", "processed_quantity": "1",
        "price": "3.00", "trade_value_multiplier": "100.0000",
        "closing_strategy": "long_call_spread", "created_at": "2026-06-10T10:00:00Z",
        "legs": [
            {"side": "sell", "position_effect": "close", "ratio_quantity": 1,
             "strike_price": "100.0", "expiration_date": "2026-07-17",
             "option_type": "call", "executions": [{"price": "3", "quantity": "1"}]},
            {"side": "buy", "position_effect": "close", "ratio_quantity": 1,
             "strike_price": "110.0", "expiration_date": "2026-07-17",
             "option_type": "call", "executions": [{"price": "0", "quantity": "1"}]},
        ]}
    result = realized_pnl_pairs([open_order, close_order])
    assert len(result["paired"]) == 1
    pair = result["paired"][0]
    # open cash -200 (debit paid), close cash +300 (credit received) -> +100
    assert pair["net_pnl"] == pytest.approx(100.0)
    assert result["unpaired"] == []
