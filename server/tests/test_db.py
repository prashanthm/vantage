"""SQLite layer: schema, WAL, history dedupe by natural key, lot accumulation."""
from __future__ import annotations

from vantage_server import db as _db
from vantage_server.store import Store


def _sqlite_store(tmp_path):
    """A Store forced onto the SQLite backend at tmp_path/vantage.db."""
    from vantage_server.store import _SqliteBackend

    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


# ----------------------------------------------------------------- schema

def test_schema_is_idempotent_and_versioned(tmp_path):
    database = _db.Database(tmp_path / "vantage.db")
    database.init_schema()
    database.init_schema()  # second call must not raise
    assert database.schema_version() == _db.SCHEMA_VERSION


def test_v20_replay_columns_and_calibration_table(tmp_path):
    """v20: spx_forecast gains run_id + the spx_calibration memory table exists."""
    database = _db.Database(tmp_path / "vantage.db")
    database.init_schema()
    conn = database.connect()
    try:
        fcols = {r["name"] for r in conn.execute("PRAGMA table_info(spx_forecast)")}
        assert "run_id" in fcols
        ccols = {r["name"] for r in conn.execute("PRAGMA table_info(spx_calibration)")}
        assert {"day", "underlying", "run_id", "scores", "narrative"} <= ccols
    finally:
        conn.close()


def test_v20_run_id_migrates_onto_old_forecast_table(tmp_path):
    """A DB that already has the v19 spx_forecast table (no run_id) gains the
    column additively — rows preserved, run_id NULL — not a rebuild."""
    path = tmp_path / "vantage.db"
    import sqlite3
    conn = sqlite3.connect(str(path))
    conn.executescript(
        "CREATE TABLE spx_forecast (id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "symbol TEXT NOT NULL, day TEXT NOT NULL, as_of TEXT NOT NULL, "
        "created_at TEXT, price_at REAL, snapshot TEXT, forecast TEXT, "
        "forecast_text TEXT, scored_at TEXT, score TEXT);"
        "INSERT INTO spx_forecast(symbol, day, as_of) VALUES('SPX','2026-07-16','x');")
    conn.commit(); conn.close()
    _db.Database(path).init_schema()   # migrate in place
    conn = sqlite3.connect(str(path))
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(spx_forecast)")}
        assert "run_id" in cols
        row = conn.execute("SELECT symbol, run_id FROM spx_forecast").fetchone()
        assert row[0] == "SPX" and row[1] is None    # preserved; new col NULL
    finally:
        conn.close()


def test_spx_calibration_round_trips(tmp_path):
    store = _sqlite_store(tmp_path)
    cid = store.save_spx_calibration({
        "day": "2026-07-16", "underlying": "SPX", "run_id": "rf-1",
        "generated_at": "2026-07-16T20:00:00Z", "prior_id": None, "n_forecasts": 5,
        "scores": {"overall": {"n": 5, "hit_rate": 0.6}},
        "patterns": [{"pattern": "midday drift", "cites": [1, 2]}],
        "narrative": "decent open reads, weak midday"})
    assert cid > 0
    got = store.load_spx_calibration_by_run("rf-1")
    assert got["scores"]["overall"]["hit_rate"] == 0.6
    assert got["patterns"][0]["pattern"] == "midday drift"
    latest = store.load_latest_spx_calibration(underlying="SPX")
    assert latest["run_id"] == "rf-1"


def test_wal_mode_is_enabled(tmp_path):
    database = _db.Database(tmp_path / "vantage.db")
    database.init_schema()
    conn = database.connect()
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        conn.close()
    assert str(mode).lower() == "wal"


def test_foreign_keys_pragma_on(tmp_path):
    database = _db.Database(tmp_path / "vantage.db")
    conn = database.connect()
    try:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    finally:
        conn.close()


def test_transaction_rolls_back_on_error(tmp_path):
    database = _db.Database(tmp_path / "vantage.db")
    database.init_schema()
    try:
        with database.transaction() as conn:
            conn.execute("INSERT INTO meta(key, value) VALUES('k', 'v')")
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    conn = database.connect()
    try:
        row = conn.execute("SELECT value FROM meta WHERE key='k'").fetchone()
    finally:
        conn.close()
    assert row is None


# ----------------------------------------------------- history dedupe

def _hist(symbol, price, state="filled", account="rh-margin"):
    return {
        "account": account, "broker_account": "...9024",
        "date": "2026-07-02T19:59:13Z", "kind": "option", "symbol": symbol,
        "description": "close", "side": "buy", "quantity": 1.0, "price": price,
        "amount": 0.0, "state": state,
    }


def test_history_dedupes_by_natural_key(tmp_path):
    store = _sqlite_store(tmp_path)
    rows = [_hist("AAA", 20.0), _hist("BBB", 21.0)]
    store.upsert_history("rh-margin", rows)
    # re-import the SAME rows plus a new one: existing dedupe, new one added
    store.upsert_history("rh-margin", [_hist("AAA", 20.0), _hist("CCC", 22.0)])
    out = store.load_history()
    symbols = sorted(r["symbol"] for r in out)
    assert symbols == ["AAA", "BBB", "CCC"], "no duplicate AAA row"
    assert len(out) == 3


def test_history_row_key_is_stable_and_distinct():
    a = _db.history_row_key(_hist("AAA", 20.0))
    a_again = _db.history_row_key(_hist("AAA", 20.0))
    b = _db.history_row_key(_hist("AAA", 21.0))
    assert a == a_again
    assert a != b


def test_history_preserves_all_columns_and_extra(tmp_path):
    store = _sqlite_store(tmp_path)
    row = _hist("AAA", 20.0)
    row["custom_field"] = "kept"
    store.upsert_history("rh-margin", [row])
    out = store.load_history()[0]
    assert out["symbol"] == "AAA"
    assert out["quantity"] == 1.0
    assert out["custom_field"] == "kept"


def test_history_preserves_explicit_null_key(tmp_path):
    """A row carrying an explicit price=None must keep the key on read (a real
    parity gotcha: cancelled orders store price as null)."""
    store = _sqlite_store(tmp_path)
    row = _hist("AAA", None, state="cancelled")
    store.upsert_history("rh-margin", [row])
    out = store.load_history()[0]
    assert "price" in out
    assert out["price"] is None


def test_history_omits_absent_key(tmp_path):
    """A key never present in the source stays absent on read (not injected)."""
    store = _sqlite_store(tmp_path)
    row = _hist("AAA", 20.0)
    del row["broker_account"]
    store.upsert_history("rh-margin", [row])
    out = store.load_history()[0]
    assert "broker_account" not in out


# ----------------------------------------------------- lots accumulate

def _lot(account, symbol, shares=10.0, cost=5.0, date="2026-07-05"):
    return {"account": account, "symbol": symbol, "date": date,
            "shares": shares, "cost_per_share": cost}


def test_lots_merge_replaces_only_named_accounts(tmp_path):
    store = _sqlite_store(tmp_path)
    store.upsert_lots(["a", "b"], [_lot("a", "AAA"), _lot("b", "BBB")],
                      mode="replace")
    # merge-import only account 'a' with a different symbol
    store.upsert_lots(["a"], [_lot("a", "ZZZ")], mode="merge")
    out = store.load_lots()
    by_acct = {(l.account, l.symbol) for l in out}
    assert ("b", "BBB") in by_acct, "other account's lots kept"
    assert ("a", "ZZZ") in by_acct, "imported account's new lots present"
    assert ("a", "AAA") not in by_acct, "imported account's old lots replaced"


def test_lots_replace_swaps_whole_set(tmp_path):
    store = _sqlite_store(tmp_path)
    store.upsert_lots(["a", "b"], [_lot("a", "AAA"), _lot("b", "BBB")],
                      mode="replace")
    store.upsert_lots(["c"], [_lot("c", "CCC")], mode="replace")
    out = store.load_lots()
    assert [l.symbol for l in out] == ["CCC"]


def test_lots_float_precision_survives(tmp_path):
    store = _sqlite_store(tmp_path)
    store.upsert_lots(["a"], [_lot("a", "SMX", shares=6.564551, cost=273.08)],
                      mode="replace")
    lot = store.load_lots()[0]
    assert lot.shares == 6.564551
    assert lot.cost_per_share == 273.08


def test_level_history_records_and_reads_back(tmp_path):
    store = _sqlite_store(tmp_path)
    n = store.record_levels(
        "2026-07-08", "SPX",
        [{"price": 7423.0, "dim": "support", "kind": "support (3x tested)",
          "source": "chart", "touches": 3},
         {"price": 7500.0, "dim": "max_pain", "kind": "max pain (pin)",
          "source": "GEX"}],
        day={"high": 7490.0, "low": 7420.0, "close": 7482.0})
    assert n == 2
    rows = store.load_level_history("SPX")
    assert len(rows) == 2
    sup = next(r for r in rows if r["dim"] == "support")
    assert sup["price"] == 7423.0 and sup["touches"] == 3
    assert sup["day_low"] == 7420.0 and sup["day_close"] == 7482.0


def test_level_history_is_idempotent_per_session_and_windowed(tmp_path):
    store = _sqlite_store(tmp_path)
    lv = [{"price": 7423.0, "dim": "support", "kind": "support (2x)", "source": "chart", "touches": 2}]
    store.record_levels("2026-07-06", "SPX", lv)
    store.record_levels("2026-07-06", "SPX", lv)  # same session — replace, not duplicate
    store.record_levels("2026-07-07", "SPX", lv)
    assert store.level_history_sessions("SPX") == ["2026-07-06", "2026-07-07"]
    assert len(store.load_level_history("SPX", since="2026-07-07")) == 1
    assert len(store.load_level_history("SPX")) == 2


def test_accounts_taxable_bool_round_trips(tmp_path):
    store = _sqlite_store(tmp_path)
    store.upsert_accounts([
        {"id": "t", "name": "Taxable", "short": "T", "type": "brokerage",
         "taxable": True, "last_sync": "never"},
        {"id": "n", "name": "Roth", "short": "R", "type": "Roth IRA",
         "taxable": False, "last_sync": "never"},
    ])
    accts = {a.id: a for a in store.load_accounts()}
    assert accts["t"].taxable is True
    assert accts["n"].taxable is False
