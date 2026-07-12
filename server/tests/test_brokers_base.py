"""Broker connection registry (brokers/base.py): registration and lookup,
protocol conformance of every registered connection, informative
NotImplementedError from the schwab-api/fidelity-api stubs (module + CLI
paths), RobinhoodConnection delegation with a stubbed MCP call, the canonical
--broker-account flag (--rh-account stays as a deprecated alias), and the
read-only doctrine holding through the class path. Fully offline."""
from __future__ import annotations

import json
import time

import pytest

from vantage_server import importer
from vantage_server.importer import (
    BROKERS,
    EXIT_OK,
    EXIT_USER_ERROR,
    PARSERS,
    api_cash_lot,
    api_positions_to_lots,
)
from vantage_server.brokers import base, robinhood
from vantage_server.brokers.aggregator import AggregatorFidelityConnection
from vantage_server.brokers.base import (
    CONNECTIONS,
    BrokerConnection,
    BrokerConnectionError,
    ReadOnlyViolation,
    get_connection,
    register_connection,
)
from vantage_server.brokers.robinhood import RobinhoodConnection
from vantage_server.brokers.schwab import SchwabConnection
from vantage_server.brokers.zerodha import ZerodhaConnection

AS_OF = "2026-07-05"


# ---------------------------------------------------------------- registry

def test_registry_holds_all_connections():
    assert CONNECTIONS == {
        "robinhood": RobinhoodConnection,
        "schwab-api": SchwabConnection,
        "fidelity-api": AggregatorFidelityConnection,
        "zerodha": ZerodhaConnection,
    }


def test_get_connection_returns_registered_class():
    assert get_connection("robinhood") is RobinhoodConnection
    assert get_connection("schwab-api") is SchwabConnection
    assert get_connection("fidelity-api") is AggregatorFidelityConnection


def test_get_connection_unknown_id_lists_registered_ids():
    with pytest.raises(ValueError) as exc:
        get_connection("etrade")
    msg = str(exc.value)
    assert "etrade" in msg
    for broker_id in ("robinhood", "schwab-api", "fidelity-api"):
        assert broker_id in msg


def test_register_connection_decorator_registers_and_returns_class():
    @register_connection
    class DummyConnection:
        broker_id = "dummy-api"
        display_name = "Dummy"

        def fetch_positions(self, account_number):
            return []

        def fetch_portfolio(self, account_number):
            return {"total_value": 0}

        def interactive_auth(self):
            pass

        def auth_status(self):
            return "grant valid"

    try:
        assert CONNECTIONS["dummy-api"] is DummyConnection  # registered
        assert DummyConnection.broker_id == "dummy-api"     # class returned intact
        # duplicate ids are refused — one module per broker
        with pytest.raises(ValueError, match="duplicate"):
            register_connection(DummyConnection)
    finally:
        del CONNECTIONS["dummy-api"]


def test_register_connection_requires_broker_id():
    class NoId:
        display_name = "Nameless"

    with pytest.raises(ValueError, match="broker_id"):
        register_connection(NoId)


# --------------------------------------------------- protocol conformance

@pytest.mark.parametrize("broker_id", sorted(CONNECTIONS))
def test_every_registered_connection_satisfies_the_protocol(broker_id):
    cls = CONNECTIONS[broker_id]
    conn = cls()
    assert isinstance(conn, BrokerConnection)  # runtime_checkable structural check
    assert cls.broker_id == broker_id
    assert isinstance(cls.display_name, str) and cls.display_name
    for method in ("fetch_positions", "fetch_portfolio",
                   "interactive_auth", "auth_status"):
        assert callable(getattr(conn, method))


def test_broker_choices_are_parsers_plus_registered_connections():
    assert BROKERS == tuple(PARSERS) + tuple(sorted(CONNECTIONS))
    assert "schwab-api" in BROKERS and "fidelity-api" in BROKERS
    # CSV parser ids and connection ids never collide
    assert not set(PARSERS) & set(CONNECTIONS)


# ------------------------------------------------------------------ stubs

@pytest.mark.parametrize("cls,pointer,csv_fallback", [
    (SchwabConnection, "brokers/schwab.py", "--broker schwab"),
    (AggregatorFidelityConnection, "brokers/aggregator.py", "--broker fidelity"),
])
def test_stub_methods_raise_informative_not_implemented(cls, pointer, csv_fallback):
    conn = cls()
    for call in (lambda: conn.fetch_positions("123"),
                 lambda: conn.fetch_portfolio("123"),
                 conn.interactive_auth):
        with pytest.raises(NotImplementedError) as exc:
            call()
        msg = str(exc.value)
        assert "stub" in msg
        assert pointer in msg        # points at the docstring TODOs
        assert csv_fallback in msg   # and at the working CSV path
    assert "stub" in conn.auth_status()


@pytest.mark.parametrize("broker_id", ["schwab-api", "fidelity-api"])
def test_cli_stub_broker_fails_informatively_exit_2(broker_id, tmp_path, capsys):
    rc = importer.main(["--data-dir", str(tmp_path), "--broker", broker_id,
                        "--account", "acct", "--broker-account", "123"])
    assert rc == EXIT_USER_ERROR
    err = capsys.readouterr().err
    assert f"{broker_id}:" in err and "stub" in err


def test_cli_stub_broker_auth_fails_informatively_exit_2(capsys):
    rc = importer.main(["--broker", "schwab-api", "--auth"])
    assert rc == EXIT_USER_ERROR
    err = capsys.readouterr().err
    assert "stub" in err and "schwab.py" in err


# ------------------------------------------------- robinhood delegation

CANNED = {"positions": [
    {"symbol": "VOO", "quantity": "12", "average_buy_price": "512.3400"},
]}


def test_robinhood_connection_fetch_positions_delegates(monkeypatch):
    calls = []

    def fake_call(tool, payload):
        calls.append((tool, payload))
        return CANNED

    monkeypatch.setattr(robinhood, "_call", fake_call)  # stub the MCP transport
    positions = RobinhoodConnection().fetch_positions("123456789")
    assert calls == [("get_equity_positions", {"account_number": "123456789"})]
    assert positions == [{"symbol": "VOO", "shares": 12.0, "avg_cost": 512.34}]


def test_robinhood_connection_fetch_portfolio_delegates(monkeypatch):
    monkeypatch.setattr(robinhood, "_call", lambda t, p: {"total_value": "5432.10"})
    assert RobinhoodConnection().fetch_portfolio("X")["total_value"] == "5432.10"


def test_robinhood_connection_interactive_auth_delegates(monkeypatch):
    from vantage_server.brokers import robinhood_auth
    ran = []
    monkeypatch.setattr(robinhood_auth, "interactive_login", lambda: ran.append(True))
    RobinhoodConnection().interactive_auth()
    assert ran == [True]


def test_robinhood_auth_status_reads_store_without_network(tmp_path, monkeypatch):
    from vantage_server.brokers import robinhood_auth
    token = tmp_path / "tok.json"
    monkeypatch.setenv(robinhood_auth.ENV_TOKEN_FILE, str(token))
    monkeypatch.setattr(robinhood_auth, "_http_post",
                        lambda *a, **k: pytest.fail("auth_status must not hit the network"))
    conn = RobinhoodConnection()
    assert "needs --auth" in conn.auth_status()          # no token file
    token.write_text(json.dumps({"access_token": "t", "refresh_token": "r",
                                 "expires_at": time.time() + 3600}))
    assert conn.auth_status().startswith("grant valid")  # fresh token
    token.write_text(json.dumps({"access_token": "t", "refresh_token": "r",
                                 "expires_at": 0}))
    assert "refreshable" in conn.auth_status()           # stale but refreshable


# ------------------------------------------------------ read-only doctrine

def test_read_only_violation_canonical_home_is_base():
    assert robinhood.ReadOnlyViolation is ReadOnlyViolation  # back-compat re-export


def test_class_path_refuses_tools_outside_allowlist(monkeypatch):
    """The allowlist holds through the connection class: were a method ever
    regressed into invoking a mutating tool, _call() still refuses it before
    any network I/O (ADR-010)."""
    conn = RobinhoodConnection()
    monkeypatch.setattr(
        robinhood, "fetch_positions",
        lambda acct: robinhood._call("place_equity_order", {"account_number": acct}),
    )
    with pytest.raises(ReadOnlyViolation, match="ADR-010"):
        conn.fetch_positions("X")


def test_class_path_only_uses_allowlisted_tools(monkeypatch):
    tools = []

    def fake_call(tool, payload):
        tools.append(tool)
        return {"positions": [], "total_value": "1.00"}

    monkeypatch.setattr(robinhood, "_call", fake_call)
    conn = RobinhoodConnection()
    conn.fetch_positions("X")
    conn.fetch_portfolio("X")
    assert tools and set(tools) <= robinhood.READ_TOOLS


def test_connection_errors_share_a_catchable_base():
    from vantage_server.brokers.robinhood_auth import AuthError
    assert issubclass(robinhood.RobinhoodError, BrokerConnectionError)
    assert issubclass(AuthError, BrokerConnectionError)


# --------------------------------------------- canonical --broker-account

@pytest.fixture
def workdir(tmp_path, data_dir):
    """A writable copy of the fixture data dir (same as test_robinhood)."""
    for name in ("accounts.json", "lots.json", "recent_buys.json",
                 "auto_buys.json", "partner_map.json", "quotes.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return tmp_path


def test_broker_account_is_the_canonical_flag(workdir, monkeypatch):
    monkeypatch.setattr(robinhood, "fetch_positions",
                        lambda acct: [{"symbol": "VOO", "shares": 12.0,
                                       "avg_cost": 512.34}])
    rc = importer.main(["--data-dir", str(workdir), "--broker", "robinhood",
                        "--account", "fid-taxable", "--broker-account", "123456789",
                        "--as-of", AS_OF])
    assert rc == EXIT_OK
    lots = json.loads((workdir / "lots.json").read_text())
    assert [l["symbol"] for l in lots if l["account"] == "fid-taxable"] == ["VOO"]


def test_rh_account_alias_still_accepted_same_dest(workdir, monkeypatch, capsys):
    monkeypatch.setattr(robinhood, "fetch_positions",
                        lambda acct: [{"symbol": "VOO", "shares": 12.0,
                                       "avg_cost": 512.34}])
    rc = importer.main(["--data-dir", str(workdir), "--broker", "robinhood",
                        "--account", "fid-taxable", "--rh-account", "123456789",
                        "--as-of", AS_OF, "--dry-run"])
    assert rc == EXIT_OK
    assert "Robinhood account ...6789" in capsys.readouterr().out


# ------------------------------------------------- back-compat aliases

def test_importer_keeps_robinhood_named_aliases():
    assert importer.robinhood_positions_to_lots is api_positions_to_lots
    assert importer.robinhood_cash_lot is api_cash_lot
