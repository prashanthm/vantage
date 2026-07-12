"""Refresh: the deliberate operator WRITE that re-pulls a broker into the store.

Every test is offline — the broker connection is a STUB that RECORDS its calls,
so we can assert refresh ever only touches READ tools (fetch_positions /
fetch_option_positions / fetch_portfolio / fetch_history / list_accounts) and
NEVER an order-placement / fund-movement path. Covers: lot replace (this account
only), history accumulate/dedupe on re-run, last_synced meta, csv-only accounts
(no broker call, no error), unknown accounts, and the POST /api/refresh route
(one-account + all-accounts, 405 for GET).
"""
from __future__ import annotations

import datetime as _dt

import pytest
from fastapi.testclient import TestClient

from vantage_server import refresh as refresh_mod
from vantage_server.api import create_app
from vantage_server.store import Store
from vantage_server.db import Database
from vantage_server.store import _SqliteBackend


AS_OF = "2026-07-06"


# ------------------------------------------------------------ stub broker

#: Any method NOT in this set is a mutation the stub must never see invoked.
READ_METHODS = frozenset({
    "fetch_positions", "fetch_option_positions", "fetch_portfolio",
    "fetch_history", "list_accounts",
})


class RecordingConnection:
    """A stubbed robinhood-shaped connection that records every method call.

    Only read methods return data; a MUTATING attribute access (place_order,
    cancel_order, transfer_funds, ...) raises AssertionError so a test proves
    refresh can never reach one."""

    broker_id = "robinhood"
    display_name = "Robinhood (stub)"

    def __init__(self, *, positions=None, options=None, portfolio=None,
                 history=None, accounts=None):
        self.calls: list[str] = []
        self._positions = positions if positions is not None else []
        self._options = options if options is not None else []
        self._portfolio = portfolio if portfolio is not None else {}
        self._history = history if history is not None else []
        self._accounts = accounts if accounts is not None else []

    def _record(self, name):
        assert name in READ_METHODS, f"non-read tool reached: {name}"
        self.calls.append(name)

    def fetch_positions(self, account_number):
        self._record("fetch_positions")
        return list(self._positions)

    def fetch_option_positions(self, account_number):
        self._record("fetch_option_positions")
        return list(self._options)

    def fetch_portfolio(self, account_number):
        self._record("fetch_portfolio")
        return dict(self._portfolio)

    def fetch_history(self, account_number, *, limit=200):
        self._record("fetch_history")
        return [dict(r) for r in self._history]

    def list_accounts(self):
        self._record("list_accounts")
        return list(self._accounts)

    # Any order/fund tool the connectors forbid — accessing it here is a bug.
    def __getattr__(self, name):
        forbidden = ("place", "cancel", "review", "order", "transfer", "sell",
                     "buy", "withdraw", "deposit")
        if any(tok in name for tok in forbidden):
            raise AssertionError(
                f"refresh reached a mutating tool '{name}' — read-only violated")
        raise AttributeError(name)


def _history_row(account, date, symbol, side, qty, price, amount):
    return {
        "account": account, "broker_account": "...9024", "date": date,
        "kind": "trade", "symbol": symbol, "description": f"{side} {symbol}",
        "side": side, "quantity": qty, "price": price, "amount": amount,
        "state": "filled",
    }


# ------------------------------------------------------------ store fixture

def _sqlite_store(data_dir):
    db_path = data_dir / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = data_dir
    store._db_path = db_path
    store._backend = _SqliteBackend(data_dir, db_path)
    Database(db_path).init_schema()
    return store


@pytest.fixture
def store(tmp_path):
    s = _sqlite_store(tmp_path)
    s.upsert_accounts([
        {"id": "rh-margin", "name": "Robinhood Margin", "short": "RH",
         "type": "brokerage", "taxable": True, "last_sync": "never"},
        {"id": "rh-main", "name": "Robinhood", "short": "RH2",
         "type": "brokerage", "taxable": True, "last_sync": "never"},
        {"id": "fid-hsa", "name": "Fidelity HSA", "short": "HSA",
         "type": "HSA", "taxable": False, "last_sync": "never"},
    ])
    # Seed one pre-existing lot in ANOTHER account to prove replace is scoped.
    s.upsert_lots(["rh-main"], [
        {"account": "rh-main", "symbol": "AAPL", "date": "2026-01-01",
         "shares": 5, "cost_per_share": 100.0},
    ], mode="merge")
    # A history row already present for rh-margin so accumulate has a baseline.
    s.upsert_history("rh-margin", [
        _history_row("rh-margin", "2026-06-01", "SPY", "buy", 1, 500.0, -500.0),
    ])
    # Persist the full broker_account so no live listing is needed.
    s.set_meta("broker_account:rh-margin", "RH-FULL-9024")
    return s


def _stub_connection(monkeypatch, conn):
    monkeypatch.setattr(refresh_mod, "get_connection", lambda broker_id: (lambda: conn))


# ------------------------------------------------------- API-broker refresh

def test_refresh_upserts_lots_replacing_only_that_account(store, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 10, "avg_cost": 120.0,
                    "current_price": 150.0}],
        portfolio={"total_value": 5000.0},
    )
    _stub_connection(monkeypatch, conn)

    result = refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)

    assert result.errors == []
    assert result.positions == 1
    lots = store.load_lots()
    by_acct = {}
    for l in lots:
        by_acct.setdefault(l.account, []).append(l.symbol)
    # rh-margin replaced with the fresh pull (NVDA + CASH remainder)
    assert "NVDA" in by_acct["rh-margin"]
    # the OTHER account's lot is untouched
    assert by_acct["rh-main"] == ["AAPL"]
    # only read tools were touched
    assert set(conn.calls) <= READ_METHODS


def test_refresh_sets_last_synced_meta(store, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 10, "avg_cost": 120.0}],
        portfolio={"total_value": 2000.0},
    )
    _stub_connection(monkeypatch, conn)
    assert store.get_meta("last_synced:rh-margin") is None
    refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)
    assert store.get_meta("last_synced:rh-margin") is not None


def test_refresh_accumulates_history_no_double_on_rerun(store, monkeypatch):
    hist = [
        _history_row("rh-margin", "2026-07-02", "NVDA", "buy", 10, 120.0, -1200.0),
        _history_row("rh-margin", "2026-07-03", "NVDA", "sell", 5, 150.0, 750.0),
    ]
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 5, "avg_cost": 120.0}],
        portfolio={"total_value": 2000.0},
        history=hist,
    )
    _stub_connection(monkeypatch, conn)

    r1 = refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)
    count_after_first = sum(
        1 for r in store.load_history() if r.get("account") == "rh-margin")
    # baseline (1 seeded) + 2 new = 3
    assert count_after_first == 3
    assert r1.new_transactions == 2

    # Running again with the SAME history must not duplicate a single row.
    r2 = refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)
    count_after_second = sum(
        1 for r in store.load_history() if r.get("account") == "rh-margin")
    assert count_after_second == count_after_first  # dedupe held
    assert r2.new_transactions == 0


def test_refresh_breaks_out_options_and_cash(store, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 10, "avg_cost": 120.0,
                    "current_price": 150.0}],
        options=[{
            "occ_symbol": "SPY 2026-07-17 750C", "underlying": "SPY",
            "position_type": "long", "contracts": 1, "multiplier": 100,
            "avg_price": 5.0, "mark": 6.0, "strike": 750, "option_type": "call",
            "expiration": "2026-07-17", "opened_at": "2026-06-01",
        }],
        portfolio={"total_value": 10000.0, "crypto_value": 500.0},
    )
    _stub_connection(monkeypatch, conn)
    result = refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)
    assert result.errors == []
    symbols = {l.symbol for l in store.load_lots() if l.account == "rh-margin"}
    assert "NVDA" in symbols
    assert "SPY 2026-07-17 750C" in symbols   # option lot
    assert "CRYPTO" in symbols                # sleeve
    assert "CASH" in symbols                  # remainder
    # option mark persisted as a quote
    quotes = store.load_quotes()["quotes"]
    assert "SPY 2026-07-17 750C" in quotes
    assert result.cash is not None and result.cash > 0


# --------------------------------------------------------- csv-only broker

def test_csv_broker_account_is_csv_only_no_broker_call(store, monkeypatch):
    def boom(_):  # get_connection must never be called for a CSV broker
        raise AssertionError("a broker connection was created for a CSV account")
    monkeypatch.setattr(refresh_mod, "get_connection", boom)

    result = refresh_mod.refresh_account(store, "fid-hsa", as_of=AS_OF)
    assert result.csv_only is True
    assert result.errors == []
    assert result.message == "re-import CSV to refresh"


# ------------------------------------------------------------ error paths

def test_unknown_account_returns_error_result(store, monkeypatch):
    result = refresh_mod.refresh_account(store, "does-not-exist")
    assert result.errors
    assert "unknown account" in result.errors[0]


def test_all_accounts_only_api_brokers(store, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 1, "avg_cost": 1.0}],
        portfolio={"total_value": 100.0},
    )
    _stub_connection(monkeypatch, conn)
    # rh-main has no persisted broker_account and no history suffix; give it one
    store.set_meta("broker_account:rh-main", "RH-FULL-0427")

    results = refresh_mod.refresh_accounts(store, None)
    accounts = {r.account for r in results}
    # Both RH accounts refreshed; the Fidelity CSV account is NOT in the API set.
    assert accounts == {"rh-margin", "rh-main"}


# -------------------------------------------------- broker-account backfill

def test_backfill_resolves_full_account_from_listing(store, monkeypatch):
    # Drop the persisted full number so refresh must back it out of a listing
    # by matching the masked ...9024 suffix from history.
    store.set_meta("broker_account:rh-margin", "")  # clear
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 1, "avg_cost": 1.0}],
        portfolio={"total_value": 100.0},
        accounts=[
            {"account_number": "111119024", "type": "margin"},
            {"account_number": "222220427", "type": "cash"},
        ],
    )
    _stub_connection(monkeypatch, conn)
    result = refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)
    assert result.errors == []
    assert "list_accounts" in conn.calls
    # the full number was persisted for next time
    assert store.get_meta("broker_account:rh-margin") == "111119024"


# -------------------------------------------------------------- POST route

def _api_client(tmp_path, monkeypatch, conn):
    store = _sqlite_store(tmp_path)
    store.upsert_accounts([
        {"id": "rh-margin", "name": "Robinhood Margin", "short": "RH",
         "type": "brokerage", "taxable": True, "last_sync": "never"},
        {"id": "fid-hsa", "name": "Fidelity HSA", "short": "HSA",
         "type": "HSA", "taxable": False, "last_sync": "never"},
    ])
    store.set_meta("broker_account:rh-margin", "RH-FULL-9024")
    # The quote snapshot (envelope as_of/source) reads the sqlite quotes table;
    # seed a minimal quote so create_app's provider has something to serve.
    store.set_quotes(
        {"NVDA": {"name": "NVDA", "price": 150.0, "day_pct": 0.0,
                  "asset_class": "equity"}},
        as_of="2026-07-06T09:30:00-04:00",
    )
    monkeypatch.setattr(refresh_mod, "get_connection", lambda b: (lambda: conn))
    return TestClient(create_app(tmp_path))


def test_post_refresh_one_account(tmp_path, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 2, "avg_cost": 100.0}],
        portfolio={"total_value": 500.0},
    )
    client = _api_client(tmp_path, monkeypatch, conn)
    r = client.post("/api/refresh", json={"account": "rh-margin"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 1
    res = body["results"][0]
    assert res["account"] == "rh-margin"
    assert res["errors"] == []
    assert res["positions"] == 1
    assert set(conn.calls) <= READ_METHODS


def test_post_refresh_all_accounts(tmp_path, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 2, "avg_cost": 100.0}],
        portfolio={"total_value": 500.0},
    )
    client = _api_client(tmp_path, monkeypatch, conn)
    r = client.post("/api/refresh", json={})
    assert r.status_code == 200
    body = r.json()
    # only the RH (API) account is refreshed; Fidelity CSV is excluded from "all"
    accounts = {res["account"] for res in body["results"]}
    assert accounts == {"rh-margin"}


def test_post_refresh_unknown_account_404(tmp_path, monkeypatch):
    conn = RecordingConnection()
    client = _api_client(tmp_path, monkeypatch, conn)
    r = client.post("/api/refresh", json={"account": "nope"})
    assert r.status_code == 404


def test_refresh_is_post_not_get(tmp_path, monkeypatch):
    conn = RecordingConnection()
    client = _api_client(tmp_path, monkeypatch, conn)
    assert client.get("/api/refresh").status_code == 405


def test_accounts_payload_carries_last_synced(tmp_path, monkeypatch):
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 2, "avg_cost": 100.0}],
        portfolio={"total_value": 500.0},
    )
    client = _api_client(tmp_path, monkeypatch, conn)
    # before refresh: last_synced falls back to the account's last_sync
    before = {a["id"]: a for a in client.get("/api/accounts").json()["accounts"]}
    assert before["rh-margin"]["last_synced"] == "never"
    client.post("/api/refresh", json={"account": "rh-margin"})
    after = {a["id"]: a for a in client.get("/api/accounts").json()["accounts"]}
    assert after["rh-margin"]["last_synced"] != "never"


def test_refresh_never_calls_a_mutating_tool(store, monkeypatch):
    """The safety property: whatever refresh does, the only broker methods it
    reaches are reads (the stub raises on any order/fund attribute)."""
    conn = RecordingConnection(
        positions=[{"symbol": "NVDA", "shares": 1, "avg_cost": 1.0}],
        options=[{
            "occ_symbol": "SPY 2026-07-17 750C", "underlying": "SPY",
            "position_type": "long", "contracts": 1, "multiplier": 100,
            "avg_price": 5.0, "mark": 6.0, "strike": 750, "option_type": "call",
            "expiration": "2026-07-17", "opened_at": "2026-06-01",
        }],
        portfolio={"total_value": 1000.0},
        history=[_history_row("rh-margin", "2026-07-02", "NVDA", "buy", 1, 1.0, -1.0)],
    )
    _stub_connection(monkeypatch, conn)
    refresh_mod.refresh_account(store, "rh-margin", as_of=AS_OF)
    assert conn.calls  # something was called
    assert set(conn.calls) <= READ_METHODS  # and it was ALL reads


# ── user-scoped connections (Kite) need no broker-side account number ────────


class UserScopedConnection(RecordingConnection):
    """A Kite-shaped connection: scopes to the authed user, so refresh must NOT
    require a broker_account. account_number is ignored by fetch_positions."""
    broker_id = "zerodha"
    display_name = "Zerodha (stub)"
    scoped_to_user = True


def test_user_scoped_connection_syncs_without_broker_account(store, monkeypatch):
    # a zerodha account with NO broker_account: meta seeded
    store.add_account({"id": "zerodha", "name": "Zerodha", "short": "Z",
                       "type": "brokerage", "taxable": True, "last_sync": "never",
                       "currency": "INR", "jurisdiction": "IN"})
    store.set_meta("broker:zerodha", "zerodha")
    conn = UserScopedConnection(
        positions=[{"symbol": "RELIANCE.NS", "shares": 20, "avg_cost": 2400.0,
                    "current_price": 2550.0}],
        portfolio={"total_value": 51000.0, "currency": "INR"})
    _stub_connection(monkeypatch, conn)

    result = refresh_mod.refresh_account(store, "zerodha", as_of=AS_OF)

    # no "broker-side account number" error — it synced
    assert result.errors == [], result.errors
    assert result.positions == 1
    assert any(l.symbol == "RELIANCE.NS" for l in store.load_lots())
    assert set(conn.calls) <= READ_METHODS  # read-only doctrine holds
