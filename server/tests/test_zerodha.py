"""Zerodha (Kite) connector: read-only refusal (ADR-010), symbol mapping,
graceful no-credential behavior. No live Kite calls — SDK/token absent."""
from __future__ import annotations

import pytest

from vantage_server.brokers.base import (
    BrokerConnectionError,
    CONNECTIONS,
    ReadOnlyViolation,
)
from vantage_server.brokers.zerodha import ZerodhaConnection, display_symbol


def test_registered_with_currency_and_jurisdiction():
    assert "zerodha" in CONNECTIONS
    conn = CONNECTIONS["zerodha"]()
    assert conn.currency == "INR" and conn.jurisdiction == "IN"


def test_display_symbol_maps_exchange_to_yahoo_suffix():
    assert display_symbol("RELIANCE", "NSE") == "RELIANCE.NS"
    assert display_symbol("hdfc", "BSE") == "HDFC.BO"
    assert display_symbol("INFY", "unknown") == "INFY.NS"  # default NSE


def test_read_only_refusal_before_network(monkeypatch):
    """The ADR-010 hard guarantee: a mutating method is refused by the
    dispatcher BEFORE any client/network is built."""
    conn = ZerodhaConnection()
    built = {"client": False}
    monkeypatch.setattr(conn, "_client",
                        lambda: built.__setitem__("client", True))
    for forbidden in ("place_order", "modify_order", "cancel_order", "place_gtt"):
        with pytest.raises(ReadOnlyViolation):
            conn._call(forbidden)
    assert built["client"] is False  # never even tried to connect


def test_fetch_normalizes_holdings(monkeypatch):
    conn = ZerodhaConnection()
    monkeypatch.setattr(conn, "_call", lambda m, *a, **k: [
        {"tradingsymbol": "RELIANCE", "exchange": "NSE", "quantity": 20,
         "average_price": 2400.0, "last_price": 2550.0},
        {"tradingsymbol": "TCS", "exchange": "NSE", "quantity": 0,   # zero -> skipped
         "average_price": 3000.0, "last_price": 3100.0},
    ])
    pos = conn.fetch_positions("acct")
    assert len(pos) == 1
    assert pos[0] == {"symbol": "RELIANCE.NS", "shares": 20.0,
                      "avg_cost": 2400.0, "current_price": 2550.0}


def test_portfolio_sums_inr(monkeypatch):
    conn = ZerodhaConnection()
    monkeypatch.setattr(conn, "_call", lambda m, *a, **k: [
        {"quantity": 20, "last_price": 2550.0},
        {"quantity": 5, "last_price": 3100.0},
    ])
    port = conn.fetch_portfolio("acct")
    assert port == {"total_value": 20 * 2550.0 + 5 * 3100.0, "currency": "INR"}


def test_no_credentials_raises_clear_error(monkeypatch):
    monkeypatch.delenv("KITE_API_KEY", raising=False)
    conn = ZerodhaConnection()
    with pytest.raises(BrokerConnectionError):
        conn._client()


def test_auth_status_without_token(monkeypatch, tmp_path):
    monkeypatch.setenv("KITE_TOKEN_FILE", str(tmp_path / "none.json"))
    assert "needs --auth" in ZerodhaConnection().auth_status()
