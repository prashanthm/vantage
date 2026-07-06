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
