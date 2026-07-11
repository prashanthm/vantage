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


# ------------------------------------------------------------ ETF -> future projection

def _etf_scaffold(spot=500.0):
    return {
        "regime": {"spot": spot, "gamma": "positive"},
        "confluence": [
            {"lo": 504.0, "hi": 506.0, "price": 505.0, "role": "resistance",
             "kinds": ["call wall"], "strength": 2},
            {"lo": 494.0, "hi": 496.0, "price": 495.0, "role": "support",
             "kinds": ["put wall"], "strength": 2},
        ],
        "table": {"rows": [
            {"price": 505.0, "label": "call wall", "role": "resistance",
             "expect": "sell rallies", "key": "A"},
            {"price": 495.0, "label": "put wall", "role": "support",
             "expect": "buy dips", "key": "B"},
        ]},
    }


def test_projection_rescales_etf_levels_to_futures_points():
    from vantage_server import futures_projection as fp
    p = fp.project_levels("NQ", _etf_scaffold(500.0), ratio=41.0)
    assert p["available"] and p["contract"] == "NQ" and p["etf"] == "QQQ"
    assert p["spot"] == 20500.0                       # 500 * 41
    res = next(z for z in p["zones"] if z["role"] == "resistance")
    assert res["price"] == 20705.0                    # 505 * 41
    lvl_b = next(l for l in p["levels"] if l["key"] == "B")
    assert lvl_b["price"] == 20295.0 and lvl_b["expect"] == "buy dips"


def test_projection_maps_contracts_to_etfs():
    from vantage_server import futures_projection as fp
    assert fp.future_etf("NQ") == "QQQ" and fp.future_etf("MNQ") == "QQQ"
    assert fp.future_etf("RTY") == "IWM" and fp.future_etf("M2K") == "IWM"
    assert fp.future_etf("ES") is None               # unmapped


def test_projection_unavailable_without_ratio_or_scaffold(monkeypatch):
    from vantage_server import futures_projection as fp
    # no live ratio available → projection unavailable (network stubbed out)
    monkeypatch.setattr(fp, "_future_last", lambda c: None)
    assert fp.project_levels("NQ", _etf_scaffold()).get("available") is not True
    # no scaffold → unavailable regardless of ratio
    assert fp.project_levels("NQ", {}, ratio=41.0).get("available") is False


def test_rty_point_values_registered():
    assert fut.POINT_VALUES["RTY"] == 50.0 and fut.POINT_VALUES["M2K"] == 5.0


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


# ------------------------------------------------------------ trader metrics

def _trips(seq):
    """Build round-trips from (entry, exit, exit_type) tuples on NQ ($20/pt)."""
    fills = []
    oid = 0
    for i, (e, x, xt) in enumerate(seq):
        oid += 1
        fills.append({"order_id": str(oid), "contract": "NQ", "point_value": 20.0,
                      "side": "Buy", "avg_fill_price": float(e), "order_type": "Market",
                      "status_time": f"2026-07-08 10:{i*2:02d}:00"})
        oid += 1
        fills.append({"order_id": str(oid), "contract": "NQ", "point_value": 20.0,
                      "side": "Sell", "avg_fill_price": float(x), "order_type": xt,
                      "status_time": f"2026-07-08 10:{i*2+1:02d}:00"})
    trips, _ = fut.pair_roundtrips(fills)
    return trips


def test_overall_expectancy_and_reward_risk():
    # 2 winners (+10pt each), 1 loser (-20pt) → win 67%, avg win 10 / loss 20,
    # R:R 0.5, expectancy = .667*10 - .333*20 = 0.0pt
    trips = _trips([(100, 110, "Market"), (110, 120, "Market"), (120, 100, "Stop")])
    ov = fut._overall(trips)
    assert ov["n"] == 3 and ov["wins"] == 2
    assert ov["avg_win_pts"] == 10.0 and ov["avg_loss_pts"] == -20.0
    assert ov["reward_risk"] == 0.5
    assert ov["expectancy_pts"] == 0.0
    assert ov["expectancy_usd"] == 0.0   # 0pt × $20


def test_equity_curve_and_drawdown():
    # +10, +10, -20 (in points → ×$20): cum 200, 400, 0. peak 400 → DD 400.
    trips = _trips([(100, 110, "Market"), (110, 120, "Market"), (120, 100, "Stop")])
    curve = fut._equity_curve(trips)
    assert [p["cum"] for p in curve] == [200.0, 400.0, 0.0]
    dd = fut._max_drawdown(curve)
    assert dd["max_drawdown"] == 400.0 and dd["max_drawdown_pct"] == 100.0


def test_risk_stats_worst_loss_and_streak():
    # one big loser then 3 straight small losers → worst = -100pt, streak 4
    trips = _trips([(100, 200, "Market"),        # +100 win
                    (200, 100, "Stop"),          # -100 (worst)
                    (100, 95, "Stop"),           # -5
                    (95, 90, "Stop"),            # -5
                    (90, 85, "Stop")])           # -5
    r = fut._risk_stats(trips)
    assert r["worst_loss_pts"] == -100.0
    assert r["worst_losing_streak"] == 4
    assert r["worst_vs_avg_loss"] is not None


def test_recommendations_flag_low_reward_risk_and_streak():
    trips = _trips([(100, 110, "Market"), (110, 120, "Market"),
                    (120, 100, "Stop"), (100, 95, "Stop"),
                    (95, 90, "Stop"), (90, 85, "Stop")])
    ov = fut._overall(trips)
    risk = fut._risk_stats(trips)
    recs = fut.generate_recommendations(ov, risk, [], {"available": False}, {},
                                        trips, with_watch=False)
    joined = " ".join(r["text"] for r in recs["rules"])
    assert "reward:risk" in joined                 # R:R rule fires (R:R < 1.5)
    assert "expectancy" in joined.lower() or "worth about" in joined.lower()
    assert recs["watch"] == []                     # watch skipped when off


def test_analyze_includes_all_dashboard_blocks():
    trips_fills = _trips([(100, 110, "Market"), (110, 90, "Stop")])
    # analyze pairs its own fills, so pass the underlying fills, not trips
    fills = []
    oid = 0
    for i, (e, x, xt) in enumerate([(100, 110, "Market"), (110, 90, "Stop")]):
        oid += 1
        fills.append({"order_id": str(oid), "contract": "NQ", "point_value": 20.0,
                      "side": "Buy", "avg_fill_price": float(e), "order_type": "Market",
                      "status_time": f"2026-07-08 10:{i*2:02d}:00"})
        oid += 1
        fills.append({"order_id": str(oid), "contract": "NQ", "point_value": 20.0,
                      "side": "Sell", "avg_fill_price": float(x), "order_type": xt,
                      "status_time": f"2026-07-08 10:{i*2+1:02d}:00"})
    a = fut.analyze(fills, [], {"realized_pnl": None}, [], align={}, with_watch=False)
    for block in ("overall", "equity_curve", "drawdown", "risk", "recommendations",
                  "buckets", "reconciliation"):
        assert block in a, f"missing {block}"
    assert isinstance(a["equity_curve"], list) and len(a["equity_curve"]) == 2
