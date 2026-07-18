"""Chart drawings store — upsert (idempotent by id), load, delete."""


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def test_upsert_load_delete_roundtrip(tmp_path):
    store = _sqlite_store(tmp_path)
    d = {"id": "d1", "symbol": "spx", "kind": "hline",
         "points": [{"time": 100, "price": 5000.5}], "style": {"color": "#abc"}}
    row = store.upsert_chart_drawing(d, now="2026-07-18T00:00:00+00:00")
    assert row["id"] == "d1" and row["symbol"] == "SPX"      # symbol upper-cased
    assert row["kind"] == "hline"

    loaded = store.load_chart_drawings("SPX")
    assert len(loaded) == 1
    assert loaded[0]["points"] == [{"time": 100, "price": 5000.5}]
    assert loaded[0]["style"]["color"] == "#abc"

    assert store.delete_chart_drawing("d1") is True
    assert store.load_chart_drawings("SPX") == []
    assert store.delete_chart_drawing("d1") is False          # already gone


def test_upsert_is_idempotent_on_id(tmp_path):
    store = _sqlite_store(tmp_path)
    base = {"id": "d9", "symbol": "NVDA", "kind": "trendline",
            "points": [{"time": 1, "price": 10}, {"time": 2, "price": 20}], "style": {}}
    store.upsert_chart_drawing(base, now="2026-07-18T00:00:00+00:00")
    # same id, moved second point → updates in place, created_at preserved
    moved = {**base, "points": [{"time": 1, "price": 10}, {"time": 2, "price": 99}]}
    store.upsert_chart_drawing(moved, now="2026-07-18T01:00:00+00:00")
    rows = store.load_chart_drawings("NVDA")
    assert len(rows) == 1                                     # not duplicated
    assert rows[0]["points"][1]["price"] == 99
    assert rows[0]["created_at"] == "2026-07-18T00:00:00+00:00"
    assert rows[0]["updated_at"] == "2026-07-18T01:00:00+00:00"


def test_load_is_symbol_scoped_and_ordered(tmp_path):
    store = _sqlite_store(tmp_path)
    store.upsert_chart_drawing({"id": "a", "symbol": "SPX", "kind": "hline",
                                "points": [{"time": 1, "price": 1}], "style": {}},
                               now="2026-07-18T00:00:01+00:00")
    store.upsert_chart_drawing({"id": "b", "symbol": "SPX", "kind": "hline",
                                "points": [{"time": 1, "price": 2}], "style": {}},
                               now="2026-07-18T00:00:02+00:00")
    store.upsert_chart_drawing({"id": "c", "symbol": "QQQ", "kind": "hline",
                                "points": [{"time": 1, "price": 3}], "style": {}},
                               now="2026-07-18T00:00:03+00:00")
    spx = store.load_chart_drawings("SPX")
    assert [r["id"] for r in spx] == ["a", "b"]              # created_at order, SPX only
    assert [r["id"] for r in store.load_chart_drawings("QQQ")] == ["c"]
