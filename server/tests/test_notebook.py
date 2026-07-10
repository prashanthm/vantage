"""Per-ticker notebook: store methods + the notebook API write/read routes.

Notebook persistence is SQLite-only, so these tests build a SQLite-backed store
at a temp dir (seeded from the fixture dataset) and drive the routes over it.
The quote provider is forced to the fixture seam so no test touches Yahoo.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from vantage_server import db as _db
from vantage_server.api import create_app
from vantage_server.store import Store, _SqliteBackend


@pytest.fixture(autouse=True)
def _fixture_quotes(monkeypatch):
    monkeypatch.setenv("VANTAGE_QUOTES", "fixture")


@pytest.fixture
def sqlite_dir(tmp_path, data_dir):
    """A temp data dir with a SQLite db seeded from the fixture accounts/lots/quotes
    so create_app loads a real dataset, plus a quotes.json for the fixture provider."""
    # Seed the SQLite store from the fixture JSON.
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    accounts = json.loads((data_dir / "accounts.json").read_text())
    lots = json.loads((data_dir / "lots.json").read_text())
    quotes = json.loads((data_dir / "quotes.json").read_text())
    store.upsert_accounts(accounts)
    ids = [a["id"] for a in accounts]
    store.upsert_lots(ids, lots, mode="replace", now="2026-07-05T00:00:00+00:00")
    store.set_quotes(quotes["quotes"], as_of=quotes["as_of"])
    # The fixture quote provider also reads quotes.json / accounts.json / lots.json off disk.
    for name in ("quotes.json", "accounts.json", "lots.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return tmp_path


@pytest.fixture
def client(sqlite_dir):
    return TestClient(create_app(sqlite_dir))


# ------------------------------------------------------------ store methods

def _store(sqlite_dir):
    db_path = sqlite_dir / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = sqlite_dir
    store._db_path = db_path
    store._backend = _SqliteBackend(sqlite_dir, db_path)
    return store


def test_plan_upsert_and_load(sqlite_dir):
    store = _store(sqlite_dir)
    assert store.load_ticker_plan("UNH") is None
    store.upsert_ticker_plan("unh", {"thesis": "hold", "target": 460, "stop": 390,
                                     "notes": "watch resistance"}, now="2026-07-06T00:00:00+00:00")
    plan = store.load_ticker_plan("UNH")
    assert plan["thesis"] == "hold" and plan["target"] == 460.0 and plan["stop"] == 390.0
    # blank target/stop become NULL, not 0
    store.upsert_ticker_plan("UNH", {"thesis": "still hold", "target": "", "stop": None,
                                     "notes": ""}, now="2026-07-06T01:00:00+00:00")
    plan = store.load_ticker_plan("UNH")
    assert plan["target"] is None and plan["stop"] is None and plan["thesis"] == "still hold"


def test_journal_append_load_and_dup_guard(sqlite_dir):
    store = _store(sqlite_dir)
    assert store.load_ticker_journal("UNH") == []
    store.append_ticker_journal("UNH", "snapshot", {"price": 418.2, "recommendation": "MONITOR"},
                                now="2026-07-06T20:00:00+00:00")
    store.append_ticker_journal("UNH", "note", {"text": "rolling the call"},
                                now="2026-07-06T21:00:00+00:00")
    rows = store.load_ticker_journal("UNH")
    assert len(rows) == 2
    assert rows[0]["kind"] == "note"  # newest first
    assert rows[1]["payload"]["price"] == 418.2
    assert store.has_ticker_journal_snapshot("UNH", "2026-07-06") is True
    assert store.has_ticker_journal_snapshot("UNH", "2026-07-07") is False


# ------------------------------------------------------------ API routes

def test_save_and_read_plan_route(client):
    r = client.post("/api/ticker/UNH/plan",
                    json={"thesis": "AI infra insurer", "target": 460, "stop": 390,
                          "notes": "watch $434"})
    assert r.status_code == 200
    assert r.json()["plan"]["thesis"] == "AI infra insurer"
    nb = client.get("/api/ticker/UNH/notebook")
    assert nb.status_code == 200
    body = nb.json()
    assert body["plan"]["target"] == 460
    assert body["journal"] == []  # no journal entries yet


def test_add_note_route(client):
    client.post("/api/ticker/UNH/plan", json={"thesis": "x"})
    r = client.post("/api/ticker/UNH/note", json={"text": "covered call viable"})
    assert r.status_code == 200
    journal = r.json()["journal"]
    assert len(journal) == 1 and journal[0]["kind"] == "note"
    assert journal[0]["payload"]["text"] == "covered call viable"


def test_empty_note_rejected(client):
    assert client.post("/api/ticker/UNH/note", json={"text": "  "}).status_code == 400


def test_notebook_route_get_only_shape(client):
    # A ticker with nothing saved: plan None, empty journal, fundamentals may be None.
    body = client.get("/api/ticker/ZZZZ/notebook").json()
    assert body["symbol"] == "ZZZZ"
    assert body["plan"] is None
    assert body["journal"] == []


# --------------------------------------------------- nightly snapshot writer

def test_snapshot_journal_writes_and_is_idempotent(sqlite_dir, monkeypatch):
    from vantage_server import snapshot_journal as sj

    # Force the fixture quote provider so no network + deterministic prices.
    monkeypatch.setenv("VANTAGE_QUOTES", "fixture")
    store = _store(sqlite_dir)

    # First run writes one snapshot per held equity underlying.
    assert sj.run(sqlite_dir, as_of="2026-07-06") == sj.EXIT_OK
    # A held fixture equity (VOO is in the fixture lots) got a snapshot row.
    voo = store.load_ticker_journal("VOO")
    assert len(voo) == 1 and voo[0]["kind"] == "snapshot"
    assert "price" in voo[0]["payload"] and "unrl" in voo[0]["payload"]

    # Second same-day run adds nothing (idempotent).
    before = len(store.load_ticker_journal("VOO"))
    sj.run(sqlite_dir, as_of="2026-07-06")
    assert len(store.load_ticker_journal("VOO")) == before


def test_snapshot_journal_skips_options_and_cusips(sqlite_dir, monkeypatch):
    from vantage_server import snapshot_journal as sj

    monkeypatch.setenv("VANTAGE_QUOTES", "fixture")
    held = sj._held_underlyings(_store(sqlite_dir).load_dataset().lots)
    assert all(" " not in s for s in held)          # no option contracts
    assert all(not s.lstrip("-").isdigit() for s in held)  # no numeric CUSIPs
    assert all(s not in {"CASH", "CRYPTO", "FUTURES"} for s in held)  # no sleeves
