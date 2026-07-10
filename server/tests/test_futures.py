"""AMP futures ingest: symbol normalize, header-name parsing, idempotent store,
round-trip pairing + P&L, reconciliation flags, and win-rate bucketing."""
from __future__ import annotations

import pytest

from vantage_server import futures as fut


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


# ------------------------------------------------------------ symbol normalize

def test_normalize_symbol_nq_and_mnq():
    nq = fut.normalize_symbol("F.US.ENQU26")
    assert nq["contract"] == "NQ" and nq["point_value"] == 20.0
    assert nq["contract_month"] == "2026-09"   # U = September
    mnq = fut.normalize_symbol("F.US.MNQU26")
    assert mnq["contract"] == "MNQ" and mnq["point_value"] == 2.0


def test_normalize_symbol_unknown_root_raises():
    with pytest.raises(fut.FuturesError):
        fut.normalize_symbol("F.US.ESZ26")   # ES not in our map — must fail loud


# ------------------------------------------------------------ parse by header NAME

_FILLED = (
    "Symbol,Side,Type,Quantity,Limit price,Stop price,Fill quantity,Avg fill price,"
    "Commission,Take profit,Stop loss,Trailing stop,Placing time,Status time,Order ID,Duration\n"
    "F.US.ENQU26,Buy,Market,1,,,1,29500.0,,,,,2026-07-08 10:00:00,2026-07-08 10:00:00,111,GTC\n"
    "F.US.ENQU26,Sell,Market,1,,,1,29520.0,,,,,2026-07-08 10:05:00,2026-07-08 10:05:00,112,GTC\n"
)
# same two orders, DIFFERENT column order + a Status column (the history file shape)
_HISTORY = (
    "Symbol,Side,Type,Quantity,Limit price,Stop price,Active at,Fill quantity,Avg fill price,"
    "Commission,Placing time,Status,Status time,Order ID,Duration\n"
    "F.US.ENQU26,Buy,Market,1,,,,1,29500.0,,2026-07-08 10:00:00,Filled,2026-07-08 10:00:00,111,GTC\n"
    "F.US.ENQU26,Sell,Market,1,,,,1,29520.0,,2026-07-08 10:05:00,Filled,2026-07-08 10:05:00,112,GTC\n"
    "F.US.ENQU26,Buy,Stop Loss,1,,29400,,0,,,2026-07-08 09:59:00,Cancelled,2026-07-08 10:01:00,113,GTC\n"
)


def test_parse_by_header_name_both_files_agree():
    fills, w = fut.parse_ampfutures_fills(_FILLED)
    hist_fills, _ = fut.parse_ampfutures_fills(_HISTORY)   # Filled subset only
    assert not w
    assert len(fills) == 2 and len(hist_fills) == 2   # cancelled row dropped
    # same Order ID → same normalized fill despite different column order
    a = {f["order_id"]: f for f in fills}
    b = {f["order_id"]: f for f in hist_fills}
    assert a["111"]["avg_fill_price"] == b["111"]["avg_fill_price"] == 29500.0
    assert a["112"]["side"] == b["112"]["side"] == "Sell"


def test_parse_orders_captures_status():
    orders, _ = fut.parse_ampfutures_orders(_HISTORY)
    assert len(orders) == 3
    statuses = {o["status"] for o in orders}
    assert "Cancelled" in statuses and "Filled" in statuses


def test_parse_balances_skips_total_row():
    txt = ("Currency,Account balance,OTE/MVO,PnL,OTE/MVO+PnL,Prev day balance\n"
           "USD,6793.02,-18.5,2277,2258.5,4516.02\n"
           "TOTAL (USD),6793.02,-18.5,2277,2258.5,4516.02\n")
    b = fut.parse_ampfutures_balances(txt)
    assert b["realized_pnl"] == 2277.0 and b["prev_balance"] == 4516.02


# ------------------------------------------------------------ idempotent store

def test_record_fills_idempotent(tmp_path):
    store = _sqlite_store(tmp_path)
    fills, _ = fut.parse_ampfutures_fills(_FILLED)
    assert store.record_futures_fills(fills) == 2
    store.record_futures_fills(fills)   # re-import — Order ID dedupe
    assert len(store.load_futures_fills()) == 2


# ------------------------------------------------------------ pairing + P&L

def test_pair_long_roundtrip_pnl():
    fills, _ = fut.parse_ampfutures_fills(_FILLED)   # buy 29500 → sell 29520
    trips, leftover = fut.pair_roundtrips(fills)
    assert len(trips) == 1 and not leftover
    t = trips[0]
    assert t["direction"] == "long" and t["points"] == 20.0
    assert t["pnl_dollars"] == 20.0 * 20.0 and t["win"] is True   # NQ $20/pt
    assert t["held_minutes"] == 5.0


def test_pair_short_roundtrip_and_mnq_multiplier():
    fills = [
        {"order_id": "1", "contract": "MNQ", "point_value": 2.0, "side": "Sell",
         "avg_fill_price": 29500.0, "status_time": "2026-07-08 10:00:00", "order_type": "Market"},
        {"order_id": "2", "contract": "MNQ", "point_value": 2.0, "side": "Buy",
         "avg_fill_price": 29480.0, "status_time": "2026-07-08 10:03:00", "order_type": "Market"},
    ]
    trips, leftover = fut.pair_roundtrips(fills)
    assert len(trips) == 1 and not leftover
    t = trips[0]
    assert t["direction"] == "short" and t["points"] == 20.0   # short profits on drop
    assert t["pnl_dollars"] == 20.0 * 2.0 and t["win"] is True  # MNQ $2/pt


def test_pair_leftover_residual():
    # two sells, one buy → nets 1 short open (a residual)
    fills = [
        {"order_id": "1", "contract": "NQ", "point_value": 20.0, "side": "Sell",
         "avg_fill_price": 29500.0, "status_time": "2026-07-08 10:00:00"},
        {"order_id": "2", "contract": "NQ", "point_value": 20.0, "side": "Buy",
         "avg_fill_price": 29490.0, "status_time": "2026-07-08 10:01:00"},
        {"order_id": "3", "contract": "NQ", "point_value": 20.0, "side": "Sell",
         "avg_fill_price": 29480.0, "status_time": "2026-07-08 10:02:00"},
    ]
    trips, leftover = fut.pair_roundtrips(fills)
    assert len(trips) == 1 and leftover == {"NQ": -1}


# ------------------------------------------------------------ reconciliation

def test_reconcile_flags_unexpected_residual():
    # computed pairs leave NQ -1 open but broker shows NO open NQ → incomplete data
    trips = [{"pnl_dollars": 200.0, "win": True}]
    leftover = {"NQ": -1}
    balances = {"realized_pnl": 200.0}
    positions = []  # broker: flat
    rec = fut.reconcile(trips, leftover, balances, positions)
    assert rec["reconciled"] is False
    assert rec["unreconciled_contracts"][0]["contract"] == "NQ"
    assert "WINDOW" in (rec["caveat"] or "")


def test_reconcile_open_position_matches_is_ok():
    # the one genuinely-open MNQ short matches the broker → reconciled if P&L matches
    trips = [{"pnl_dollars": 100.0, "win": True}]
    leftover = {"MNQ": -1}
    balances = {"realized_pnl": 100.0}
    positions = [{"contract": "MNQ", "signed_qty": -1.0}]
    rec = fut.reconcile(trips, leftover, balances, positions)
    assert rec["reconciled"] is True and not rec["unreconciled_contracts"]


def test_reconcile_pnl_delta_flips_false():
    trips = [{"pnl_dollars": 500.0, "win": True}]
    rec = fut.reconcile(trips, {}, {"realized_pnl": 100.0}, [])
    assert rec["reconciled"] is False and rec["delta"] == 400.0


# ------------------------------------------------------------ analysis / buckets

def test_analyze_populates_buckets_and_overall():
    fills = []
    # 4 clean NQ round-trips: 3 winners exited Market, 1 loser exited Stop
    seq = [(29500, 29520, "Market"), (29520, 29540, "Market"),
           (29540, 29560, "Market"), (29560, 29540, "Stop")]
    oid = 0
    for i, (entry, exit_, xtype) in enumerate(seq):
        oid += 1
        fills.append({"order_id": str(oid), "contract": "NQ", "point_value": 20.0,
                      "side": "Buy", "avg_fill_price": float(entry), "order_type": "Market",
                      "status_time": f"2026-07-08 10:{i*2:02d}:00"})
        oid += 1
        fills.append({"order_id": str(oid), "contract": "NQ", "point_value": 20.0,
                      "side": "Sell", "avg_fill_price": float(exit_), "order_type": xtype,
                      "status_time": f"2026-07-08 10:{i*2+1:02d}:00"})
    a = fut.analyze(fills, [], {"realized_pnl": None}, [], align={})
    assert a["overall"]["n"] == 4 and a["overall"]["wins"] == 3
    # exit_type bucket exists with Market and Stop values
    exit_vals = {b["value"] for b in a["buckets"] if b["dimension"] == "exit_type"}
    assert {"Market", "Stop"} <= exit_vals


def test_order_behavior_cancel_rate():
    orders, _ = fut.parse_ampfutures_orders(_HISTORY)
    ob = fut._order_behavior(orders)
    assert ob["available"] and ob["total_orders"] == 3
    assert ob["cancelled"] == 1 and round(ob["cancel_rate"], 2) == 0.33
