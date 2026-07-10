"""Paper trading: SPX→SPY translation, ticket generation, settle target/stop, stats."""
from __future__ import annotations

import datetime as _dt

import pandas as pd

from vantage_server import paper


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


# ------------------------------------------------------------ translation

def test_to_spy_and_nearest_strike():
    assert paper.to_spy(7547.0, 10.0) == 754.7
    assert paper.nearest_strike(754.61) == 755.0
    assert paper.nearest_strike(754.4) == 754.0


# ------------------------------------------------------------ tickets

def _scaffold():
    return {
        "regime": {"spot": 7543.0},
        "confluence": [
            {"price": 7547.0, "role": "resistance", "kinds": ["resistance", "round"]},
            {"price": 7500.0, "role": "support", "kinds": ["fib", "max_pain"]},
            {"price": 7473.0, "role": "support", "kinds": ["support", "flip"]},
        ],
    }


def test_build_tickets_entry_at_level_and_rr():
    tickets = paper.build_tickets(_scaffold(), spy_price=754.3, ratio=10.0)
    # a resistance above spot → fade rally (short); supports below → buy dip (long)
    shorts = [t for t in tickets if t["side"] == "short"]
    longs = [t for t in tickets if t["side"] == "long"]
    assert shorts and longs
    s = shorts[0]
    # entry is AT the level (7547 → 754.70), not at spot; stop above, target below
    assert s["spy_entry"] == 754.7
    assert s["spy_stop"] > s["spy_entry"] > s["spy_target"]
    assert s["reward_risk"] and s["reward_risk"] > 0
    long0 = longs[0]
    assert long0["spy_stop"] < long0["spy_entry"] < long0["spy_target"]


def test_no_tickets_without_confluence():
    assert paper.build_tickets({"regime": {"spot": 7543}, "confluence": []}, 754, 10) == []


# ------------------------------------------------------------ open + settle

def test_open_and_settle_target_hit(tmp_path):
    store = _sqlite_store(tmp_path)
    tid = paper.open_paper_trade(store, {
        "signal": "buy dip 750", "side": "long", "spx_level": 7500,
        "spy_entry": 750.0, "spy_target": 755.0, "spy_stop": 748.0, "shares": 100,
        "ref_strike": 750}, now=_dt.datetime(2026, 7, 10, 10, 0))
    assert tid and len(store.load_paper_trades("open")) == 1
    idx = pd.to_datetime(["2026-07-10 10:15", "2026-07-10 10:30"])
    bars = pd.DataFrame({"High": [752, 756], "Low": [749, 753], "Close": [751, 755]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "target" and res["spy_exit"] == 755.0
    assert res["pnl"] == 500.0            # (755-750)*100


def test_settle_stop_hit_short(tmp_path):
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "fade 760", "side": "short", "spx_level": 7600,
        "spy_entry": 760.0, "spy_target": 755.0, "spy_stop": 762.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    idx = pd.to_datetime(["2026-07-10 10:15"])
    bars = pd.DataFrame({"High": [763], "Low": [759], "Close": [762]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "stop" and res["spy_exit"] == 762.0
    assert res["pnl"] == -200.0           # short: (762-760)*-1*100


def test_settle_ignores_bars_before_open(tmp_path):
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "buy 750", "side": "long", "spy_entry": 750.0,
        "spy_target": 755.0, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    # a bar BEFORE the open touched the target — must be ignored
    idx = pd.to_datetime(["2026-07-10 09:00", "2026-07-10 10:15"])
    bars = pd.DataFrame({"High": [760, 751], "Low": [740, 749], "Close": [755, 750]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res is None                    # neither target nor stop hit AFTER open


def test_close_manually_and_stats(tmp_path):
    store = _sqlite_store(tmp_path)
    tid = paper.open_paper_trade(store, {
        "signal": "buy 750", "side": "long", "spy_entry": 750.0,
        "spy_target": 755.0, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    assert paper.close_manually(store, tid, 753.0, now=_dt.datetime(2026, 7, 10, 11, 0))
    closed = store.load_paper_trades("closed")
    assert len(closed) == 1 and closed[0]["exit_reason"] == "manual"
    assert closed[0]["pnl"] == 300.0
    stats = paper.paper_stats(closed)
    assert stats["n"] == 1 and stats["wins"] == 1 and stats["win_rate"] == 1.0
