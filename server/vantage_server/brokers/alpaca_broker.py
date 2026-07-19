"""Alpaca read connection (ADR-015 lifecycle broker) — READ-ONLY, like every
other module in this package.

The strategy lifecycle validates + runs on Alpaca. This module is the READ half:
account + positions over Alpaca's REST API, normalized to the shared Position
shape. It follows brokers/base.py's read-only doctrine exactly — every remote
call goes through _get(), which refuses any path outside the frozen READ_PATHS
allowlist BEFORE any network I/O. The ORDER path is a separate, unregistered
module (alpaca_execution.py, ADR-015), never reachable from here.

Transport is stdlib urllib (no new dependency; same choice as the quotes
overlay). Credentials come from the environment (ALPACA_API_KEY /
ALPACA_SECRET_KEY); paper vs live is the base URL, chosen by ALPACA_PAPER
(default paper) — a URL flip, not a second code path. With no credentials the
module is import-safe and every call raises a clear BrokerConnectionError
(degrade, never crash), so the package imports fine in dev/CI.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from . import base
from .base import BrokerConnectionError, Position, ReadOnlyViolation, register_connection

#: The ONLY REST paths this read module will ever GET. Disjoint from the order
#: module's allowlist; anything outside raises ReadOnlyViolation before I/O.
READ_PATHS = frozenset({
    "/v2/account",
    "/v2/positions",
})

PAPER_BASE = "https://paper-api.alpaca.markets"
LIVE_BASE = "https://api.alpaca.markets"


def is_paper() -> bool:
    """Paper unless ALPACA_PAPER is explicitly '0' — paper is the safe default."""
    return os.environ.get("ALPACA_PAPER", "1") != "0"


def _base_url() -> str:
    return PAPER_BASE if is_paper() else LIVE_BASE


def _creds() -> tuple[str, str]:
    key = os.environ.get("ALPACA_API_KEY", "")
    secret = os.environ.get("ALPACA_SECRET_KEY", "")
    if not key or not secret:
        raise BrokerConnectionError(
            "Alpaca credentials missing — set ALPACA_API_KEY and "
            "ALPACA_SECRET_KEY (paper keys for the paper endpoint)."
        )
    return key, secret


def _get(path: str, timeout: float = 15.0) -> dict | list:
    """The single read dispatcher. Refuses any path outside READ_PATHS BEFORE
    touching the network (the ADR-010 read-only guarantee, transport-layer)."""
    if path not in READ_PATHS:
        raise ReadOnlyViolation(
            f"path '{path}' is not in the Alpaca read allowlist "
            f"{sorted(READ_PATHS)} — this connection is read-only (ADR-010); "
            f"orders live in alpaca_execution.py (ADR-015)."
        )
    key, secret = _creds()
    req = urllib.request.Request(
        _base_url() + path,
        headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise BrokerConnectionError(f"Alpaca {path} → HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise BrokerConnectionError(f"Alpaca {path} unreachable: {e}") from e


@(register_connection if "alpaca" not in base.CONNECTIONS else (lambda c: c))
class AlpacaConnection:
    """Read-only Alpaca connection. broker_id 'alpaca'. Authenticates as the
    key's account, so no broker-side account number is needed."""

    broker_id = "alpaca"
    display_name = "Alpaca"
    scoped_to_user = True   # key IS the account; refresh passes no account number

    def fetch_positions(self, account_number: str) -> list[dict]:
        rows = _get("/v2/positions")
        out: list[dict] = []
        for r in rows if isinstance(rows, list) else []:
            sym = str(r.get("symbol") or "").upper()
            qty = float(r.get("qty") or 0)
            if not sym or qty == 0:
                continue
            pos: Position = {
                "symbol": sym,
                "shares": qty,
                "avg_cost": float(r.get("avg_entry_price") or 0),
            }
            px = r.get("current_price")
            if px is not None:
                pos["current_price"] = float(px)
            out.append(dict(pos))
        return out

    def fetch_portfolio(self, account_number: str) -> dict:
        acct = _get("/v2/account")
        if not isinstance(acct, dict):
            raise BrokerConnectionError("Alpaca /v2/account returned no object")
        return {
            "total_value": float(acct.get("portfolio_value") or 0),
            "cash": float(acct.get("cash") or 0),
            "buying_power": float(acct.get("buying_power") or 0),
            # account-wide day change (equity vs yesterday's close).
            "day_pnl": round(float(acct.get("equity") or 0) - float(acct.get("last_equity") or 0), 2),
            "currency": str(acct.get("currency") or "USD"),
            "paper": is_paper(),
        }

    def day_pnl(self, symbols: set[str] | None = None) -> tuple[float, int]:
        """Today's intraday P&L (signed $) + open-position count for a strategy's
        universe. Sums Alpaca's per-position `unrealized_intraday_pl` over the open
        positions whose symbol is in `symbols` (None = the whole account). This is
        what the max_daily_loss_usd cap reads to auto-pause a live strategy. Raises
        BrokerConnectionError on a broker failure — the caller decides how to handle
        (the autonomous driver treats an unknown P&L as 0 and logs, never blindly
        opens more risk on a stale read)."""
        rows = _get("/v2/positions")
        pnl, n = 0.0, 0
        for r in rows if isinstance(rows, list) else []:
            sym = str(r.get("symbol") or "").upper()
            if symbols is not None and sym not in symbols:
                continue
            if float(r.get("qty") or 0) == 0:
                continue
            n += 1
            pnl += float(r.get("unrealized_intraday_pl") or 0)
        return round(pnl, 2), n

    def interactive_auth(self) -> None:
        raise base.NotSupported(
            "Alpaca uses API keys (ALPACA_API_KEY / ALPACA_SECRET_KEY), "
            "no interactive OAuth flow."
        )

    def auth_status(self) -> str:
        key = os.environ.get("ALPACA_API_KEY", "")
        if not key or not os.environ.get("ALPACA_SECRET_KEY", ""):
            return "needs ALPACA_API_KEY + ALPACA_SECRET_KEY"
        return f"key set · {'paper' if is_paper() else 'LIVE'} endpoint"


def _demo() -> None:
    """assert-based self-check (run: python -m vantage_server.brokers.alpaca_broker).
    Proves the read-only refusal path without any network or credentials."""
    # the refusal guarantee: a non-allowlisted path raises BEFORE any I/O.
    try:
        _get("/v2/orders")   # an ORDER path — must never be reachable here
        raise AssertionError("read dispatcher did not refuse /v2/orders")
    except ReadOnlyViolation:
        pass
    # placing/cancelling paths equally refused.
    for bad in ("/v2/orders/123", "/v2/account/configurations", "DELETE /v2/positions"):
        try:
            _get(bad)
            raise AssertionError(f"read dispatcher did not refuse {bad}")
        except ReadOnlyViolation:
            pass
    # an allowlisted path with NO creds degrades to a clear error (never a crash).
    saved = (os.environ.pop("ALPACA_API_KEY", None),
             os.environ.pop("ALPACA_SECRET_KEY", None))
    try:
        _get("/v2/account")
        raise AssertionError("expected BrokerConnectionError with no creds")
    except BrokerConnectionError:
        pass
    finally:
        if saved[0] is not None:
            os.environ["ALPACA_API_KEY"] = saved[0]
        if saved[1] is not None:
            os.environ["ALPACA_SECRET_KEY"] = saved[1]
    assert AlpacaConnection.broker_id == "alpaca"
    assert is_paper() is True  # default

    # day_pnl scoping — no network: stub _get (via globals() so a `python -m` double
    # import still patches the right module) to a fixed list and check it sums
    # unrealized_intraday_pl only over the requested symbols.
    _orig_get = globals()["_get"]
    globals()["_get"] = lambda path, timeout=15.0: [
        {"symbol": "SPY", "qty": "10", "unrealized_intraday_pl": "-120.5"},
        {"symbol": "QQQ", "qty": "5", "unrealized_intraday_pl": "40.0"},
        {"symbol": "AAPL", "qty": "3", "unrealized_intraday_pl": "999.0"},  # not in scope
        {"symbol": "IWM", "qty": "0", "unrealized_intraday_pl": "50.0"},    # zero qty skipped
    ]
    try:
        pnl, n = AlpacaConnection().day_pnl({"SPY", "QQQ", "IWM"})
        assert pnl == -80.5, pnl        # -120.5 + 40.0, AAPL excluded, IWM zero-qty skipped
        assert n == 2, n                 # SPY + QQQ open
        assert AlpacaConnection().day_pnl(set()) == (0.0, 0)   # empty scope → 0 (still stubbed)
    finally:
        globals()["_get"] = _orig_get
    print("ok — alpaca_broker read-only refusal + day_pnl self-check passed")


if __name__ == "__main__":
    _demo()
