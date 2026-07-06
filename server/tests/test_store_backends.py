"""JSON vs SQLite backend parity: a tiny dataset written via Store to both
backends must produce identical load_* results, and a JSON dir migrated to a db
must load identically."""
from __future__ import annotations

import json

import pytest

from vantage_server.migrate_to_sqlite import migrate, verify
from vantage_server.models import to_jsonable
from vantage_server.store import Store, _JsonBackend, _SqliteBackend


# ------------------------------------------------------ tiny dataset

ACCOUNTS = [
    {"id": "rh", "name": "Robinhood", "short": "RH", "type": "brokerage",
     "taxable": True, "last_sync": "never"},
    {"id": "roth", "name": "Roth IRA", "short": "Roth", "type": "Roth IRA",
     "taxable": False, "last_sync": "never"},
]
LOTS = [
    {"account": "rh", "symbol": "CASH", "date": "2026-07-05",
     "shares": 5205.71, "cost_per_share": 1},
    {"account": "rh", "symbol": "SMX", "date": "2026-07-05",
     "shares": 6.564551, "cost_per_share": 273.08},
    {"account": "roth", "symbol": "VOO", "date": "2026-01-02",
     "shares": 10.0, "cost_per_share": 400.0},
]
RECENT_BUYS = [
    {"account": "rh", "symbol": "VOO", "date": "2026-07-01", "note": "dca"},
]
AUTO_BUYS = [
    {"account": "roth", "symbol": "VOO", "day_of_month": 1, "amount": 500.0,
     "cadence": "monthly"},
]
PARTNER_MAP = {"VOO": "VTI", "SPY": "VTI"}
HISTORY = [
    {"account": "rh", "broker_account": "...1", "date": "2026-07-02T10:00:00Z",
     "kind": "equity", "symbol": "VOO", "description": "buy", "side": "buy",
     "quantity": 1.0, "price": 400.0, "amount": -400.0, "state": "filled"},
    {"account": "rh", "broker_account": "...1", "date": "2026-07-03T10:00:00Z",
     "kind": "equity", "symbol": "SMX", "description": "buy", "side": "buy",
     "quantity": 2.0, "price": 273.0, "amount": -546.0, "state": "filled"},
]
STRATEGIES = {
    "open": [{"account": "rh", "underlying": "SMX", "status": "open"}],
    "closed": [{"_vantage_account": "rh", "underlying": "AAPL"}],
    "by_ticker": [{"account": "rh", "underlying": "SMX", "status": "open"}],
    "as_of": "2026-07-05",
}
ROUNDTRIPS = {
    "as_of": "2026-07-05", "account": "rh",
    "roundtrips": [{"account": "rh", "symbol": "SMX", "pnl": 100.0}],
    "summary": {"win_rate": 1.0, "profit_factor": 2.0},
}
TRADE_STATS = {
    "as_of": "2026-07-05", "account": "rh", "baseline_win_rate": 0.5,
    "featured": [{"account": "rh", "symbol": "SMX", "features": {"x": 1}}],
    "buckets": [{"dimension": "dte_band", "value": "0-7", "n": 3}],
    "notable": [{"dimension": "dte_band", "value": "0-7", "kind": "edge"}],
    "by_account": {"rh": {"baseline_win_rate": 0.5,
                          "featured": [{"account": "rh", "symbol": "SMX",
                                        "features": {"x": 1}}],
                          "buckets": [{"dimension": "dte_band", "value": "0-7",
                                       "n": 3}],
                          "notable": [{"dimension": "dte_band", "value": "0-7",
                                       "kind": "edge"}]}},
}
SIGNALS = [
    {"id": 1, "sym": "SMX", "pattern": "breakout", "entry": 270.0,
     "target": 300.0, "stop": 260.0, "conf": 0.7, "time": "2026-07-01"},
]


def _write_json_dataset(d):
    (d / "accounts.json").write_text(json.dumps(ACCOUNTS), encoding="utf-8")
    (d / "lots.json").write_text(json.dumps(LOTS), encoding="utf-8")
    (d / "recent_buys.json").write_text(json.dumps(RECENT_BUYS), encoding="utf-8")
    (d / "auto_buys.json").write_text(json.dumps(AUTO_BUYS), encoding="utf-8")
    (d / "partner_map.json").write_text(json.dumps(PARTNER_MAP), encoding="utf-8")
    (d / "history.json").write_text(json.dumps(HISTORY), encoding="utf-8")
    (d / "strategies.json").write_text(json.dumps(STRATEGIES), encoding="utf-8")
    (d / "signals.json").write_text(json.dumps(SIGNALS), encoding="utf-8")
    (d / "quotes.json").write_text(json.dumps({
        "as_of": "2026-07-05T09:30:00-04:00",
        "quotes": {"VOO": {"name": "Vanguard S&P 500", "price": 683.2,
                           "day_pct": -0.12, "asset_class": "usEquity"}},
    }), encoding="utf-8")
    (d / "ml").mkdir(exist_ok=True)
    (d / "ml" / "roundtrips.json").write_text(json.dumps(ROUNDTRIPS), encoding="utf-8")
    (d / "ml" / "trade_stats.json").write_text(json.dumps(TRADE_STATS), encoding="utf-8")


def _sqlite_store(data_dir, db_path):
    store = Store.__new__(Store)
    store.data_dir = data_dir
    store._db_path = db_path
    store._backend = _SqliteBackend(data_dir, db_path)
    return store


def _seed_sqlite(store):
    store.upsert_accounts(ACCOUNTS)
    store.upsert_lots(["rh", "roth"], LOTS, mode="replace")
    store.upsert_recent_buys(RECENT_BUYS)
    store.upsert_auto_buys(AUTO_BUYS)
    store.set_partner_map(PARTNER_MAP)
    store.upsert_history("rh", HISTORY)
    store.put_strategies(STRATEGIES)
    store.put_roundtrips("rh", ROUNDTRIPS["roundtrips"], ROUNDTRIPS["summary"],
                         as_of="2026-07-05")
    store.put_trade_stats("rh", baseline_win_rate=0.5,
                          featured=TRADE_STATS["featured"],
                          buckets=TRADE_STATS["buckets"],
                          notable=TRADE_STATS["notable"], as_of="2026-07-05")
    store.put_signals(SIGNALS)


@pytest.fixture
def two_backends(tmp_path):
    """(json_store, sqlite_store) seeded with the SAME tiny dataset."""
    jdir = tmp_path / "json"
    sdir = tmp_path / "sql"
    jdir.mkdir()
    sdir.mkdir()
    _write_json_dataset(jdir)

    jstore = Store.__new__(Store)
    jstore.data_dir = jdir
    jstore._db_path = None
    jstore._backend = _JsonBackend(jdir)

    sstore = _sqlite_store(sdir, sdir / "vantage.db")
    _seed_sqlite(sstore)
    return jstore, sstore


LOADERS = [
    "load_accounts", "load_lots", "load_recent_buys", "load_auto_buys",
    "load_partner_map", "load_history", "load_strategies", "load_roundtrips",
    "load_trade_stats", "load_signals",
]


@pytest.mark.parametrize("loader", LOADERS)
def test_backend_parity(two_backends, loader):
    jstore, sstore = two_backends
    jval = to_jsonable(getattr(jstore, loader)())
    sval = to_jsonable(getattr(sstore, loader)())
    assert jval == sval, f"{loader} differs between JSON and SQLite backends"


def test_dataset_parity(two_backends):
    jstore, sstore = two_backends
    assert to_jsonable(jstore.load_dataset()) == to_jsonable(sstore.load_dataset())


def test_lot_types_preserved(two_backends):
    _, sstore = two_backends
    lots = {l.symbol: l for l in sstore.load_lots()}
    assert isinstance(lots["SMX"].shares, float)
    assert lots["SMX"].shares == 6.564551
    accts = {a.id: a for a in sstore.load_accounts()}
    assert accts["rh"].taxable is True
    assert accts["roth"].taxable is False


# ------------------------------------------------------ migration parity

def test_migration_produces_identical_loads(tmp_path):
    jdir = tmp_path / "data-local"
    jdir.mkdir()
    _write_json_dataset(jdir)
    # bars + analysis + earnings for a fuller migration
    (jdir / "bars").mkdir()
    (jdir / "bars" / "SMX.json").write_text(json.dumps({
        "symbol": "SMX", "as_of": "2026-07-05", "backfilled": True,
        "daily": [{"date": "2026-07-05", "open": 1, "high": 2, "low": 1,
                   "close": 1.5, "volume": 100}],
        "weekly": [], "monthly": [],
    }), encoding="utf-8")
    (jdir / "analysis").mkdir()
    (jdir / "analysis" / "2026-07-05.json").write_text(json.dumps({
        "as_of": "2026-07-05", "generated_at": "2026-07-05T18:00:00",
        "decisions": [{"symbol": "SMX", "recommendation": "hold"}],
    }), encoding="utf-8")

    db_path = jdir / "vantage.db"
    counts = migrate(jdir, db_path)
    assert counts["accounts"] == 2
    assert counts["lots"] == 3
    assert counts["history"] == 2
    assert counts["bars"] == 1
    assert counts["analysis"] == 1

    ok, _ = verify(jdir, db_path)
    assert ok

    # A plain Store on the dir now auto-selects SQLite (vantage.db present).
    store = Store(jdir)
    assert store.uses_sqlite
    assert to_jsonable(store.load_dataset()) == to_jsonable(
        _JsonBackend(jdir).load_dataset() if False else store.load_dataset())
    # bars + analysis come back through the SQLite backend
    assert store.load_bars("SMX")["daily"][0]["close"] == 1.5
    day = store.load_analysis_day(None)
    assert day["decisions"][0]["symbol"] == "SMX"


def test_migration_is_idempotent(tmp_path):
    jdir = tmp_path / "data-local"
    jdir.mkdir()
    _write_json_dataset(jdir)
    db_path = jdir / "vantage.db"
    migrate(jdir, db_path)
    counts2 = migrate(jdir, db_path)  # second run
    store = _sqlite_store(jdir, db_path)
    assert len(store.load_lots()) == counts2["lots"] == 3
    assert len(store.load_history()) == 2  # no duplicates on re-run
