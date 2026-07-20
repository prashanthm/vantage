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
#: GET-only prefixes for parameterized reads — order STATUS (`/v2/orders/{id}` or
#: `/v2/orders?status=...`). Read-only: the write verbs (POST/DELETE /v2/orders)
#: live in alpaca_execution.py; this module only ever GETs. A prefix, not exact,
#: because the order id is in the path.
READ_PREFIXES = ("/v2/orders",)

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
    # exact allowlist OR a read-only prefix (order status). The prefix match is on
    # the path BEFORE any query string, so only the allowed resource is reachable.
    _base = path.split("?", 1)[0]
    if path not in READ_PATHS and not any(
            _base == p or _base.startswith(p + "/") for p in READ_PREFIXES):
        raise ReadOnlyViolation(
            f"path '{path}' is not in the Alpaca read allowlist "
            f"{sorted(READ_PATHS)} (+ read prefixes {READ_PREFIXES}) — this "
            f"connection is read-only (ADR-010); orders live in "
            f"alpaca_execution.py (ADR-015)."
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

    def order_status(self, order_id: str) -> dict:
        """Read-only status of one order — what the scanner-spread reconcile loop
        polls to detect a fill. Returns {id, status, filled_avg_price, filled_qty,
        symbol, side}. status is Alpaca's order lifecycle (new / accepted /
        partially_filled / filled / canceled / rejected / expired). GET only —
        submission/cancel live in alpaca_execution.py (ADR-015)."""
        o = _get(f"/v2/orders/{order_id}")
        if not isinstance(o, dict):
            return {"id": order_id, "status": "unknown"}
        return {
            "id": o.get("id"),
            "status": str(o.get("status") or "unknown"),
            "filled_avg_price": (float(o["filled_avg_price"])
                                 if o.get("filled_avg_price") is not None else None),
            "filled_qty": float(o.get("filled_qty") or 0),
            "symbol": o.get("symbol"),
            "side": o.get("side"),
        }

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
    # the refusal guarantee: a non-allowlisted path raises BEFORE any I/O. Order
    # STATUS (GET /v2/orders[/id]) is now an allowed READ prefix — but everything
    # ELSE is still refused. (Writes to /v2/orders go through alpaca_execution's
    # _order_call, a different module; this GET-only reader can never place/cancel.)
    for bad in ("/v2/account/configurations", "/v2/assets", "/v2/watchlists",
                "/v2/orderss", "/v2/order"):
        try:
            _get(bad)
            raise AssertionError(f"read dispatcher did not refuse {bad}")
        except ReadOnlyViolation:
            pass
    # order-status reads ARE allowed — the guard must NOT raise ReadOnlyViolation
    # for them (they'd degrade to a creds/network error, which is fine). Run with
    # creds cleared so this never actually hits the network.
    _pk = (os.environ.pop("ALPACA_API_KEY", None), os.environ.pop("ALPACA_SECRET_KEY", None))
    try:
        for ok in ("/v2/orders", "/v2/orders/abc-123", "/v2/orders?status=open"):
            try:
                _get(ok)
            except ReadOnlyViolation:
                raise AssertionError(f"read dispatcher wrongly refused allowed read {ok}")
            except BrokerConnectionError:
                pass   # expected — no creds → clear error, not a refusal
    finally:
        if _pk[0] is not None:
            os.environ["ALPACA_API_KEY"] = _pk[0]
        if _pk[1] is not None:
            os.environ["ALPACA_SECRET_KEY"] = _pk[1]
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
