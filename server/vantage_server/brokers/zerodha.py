"""Zerodha (Kite Connect) connector — READ-ONLY, INR.

The first non-US broker: an INR-denominated Indian equity account. Follows the
BrokerConnection protocol and the ADR-010 read-only doctrine — every Kite call
routes through one dispatcher with a frozen GET-only allowlist; anything that
could place or modify an order raises ReadOnlyViolation before any network I/O.

AUTH (Kite Connect, developer.kite.trade):
  KITE_API_KEY, KITE_API_SECRET — the app's key/secret.
  KITE_TOKEN_FILE — token-file override (env > server default
  ``server/.kite_token.json``), chmod 600, values never printed.
Kite's access_token expires daily (~06:00 IST), so ``interactive_auth`` runs
the once-a-day login: print the login URL, exchange the pasted request_token
for an access_token via api_secret, persist it. ``auth_status`` reports the
stored token's day (valid until the next ~06:00 IST rollover).

POSITIONS: Kite ``holdings()`` (delivery/long-term) → each holding's
``tradingsymbol`` + ``exchange`` (NSE/BSE) becomes ``<SYM>.NS``/``.BO`` so
quotes.py prices it on Yahoo in INR; ``quantity`` and ``average_price`` map to
shares/avg_cost. Amounts stay INR — the account is INR. ``fetch_portfolio``
sums holdings market value in INR.

The ``kiteconnect`` SDK is imported lazily so the module (and its refusal-path
test) load without it installed; a real fetch without the SDK/token raises a
clear BrokerConnectionError pointing at setup.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from .base import (
    BrokerConnectionError,
    NotSupported,
    ReadOnlyViolation,
    register_connection,
)

ENV_API_KEY = "KITE_API_KEY"
ENV_API_SECRET = "KITE_API_SECRET"
ENV_TOKEN_FILE = "KITE_TOKEN_FILE"

# The ONLY Kite methods this connector may call (ADR-010). Everything else —
# place_order, modify_order, cancel_order, place_gtt, ... — is refused.
_READ_ONLY_ALLOWLIST = frozenset({"holdings", "positions", "profile", "ltp", "margins"})

_EXCHANGE_SUFFIX = {"NSE": ".NS", "BSE": ".BO"}


def _token_file() -> Path:
    env = os.environ.get(ENV_TOKEN_FILE)
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / ".kite_token.json"


def _load_token() -> dict | None:
    path = _token_file()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _save_token(data: dict) -> None:
    path = _token_file()
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def display_symbol(tradingsymbol: str, exchange: str) -> str:
    """Kite's bare tradingsymbol + exchange -> the Yahoo-priceable symbol
    (``RELIANCE`` + ``NSE`` -> ``RELIANCE.NS``). Unknown exchange -> .NS
    (NSE is the default for Indian equities)."""
    return f"{tradingsymbol.upper()}{_EXCHANGE_SUFFIX.get(exchange.upper(), '.NS')}"


@register_connection
class ZerodhaConnection:
    """Read-only Kite Connect connector for an INR Indian-equity account."""

    broker_id = "zerodha"
    display_name = "Zerodha (Kite)"
    currency = "INR"
    jurisdiction = "IN"
    scoped_to_user = True  # Kite scopes to the authed user — no account number

    def __init__(self) -> None:
        self._kite = None  # lazily built on first authed call

    # -- ADR-010 read-only dispatcher ---------------------------------------

    def _call(self, method: str, *args, **kwargs):
        """The ONE path to Kite. Refuses any non-allowlisted method BEFORE
        building the client or touching the network."""
        if method not in _READ_ONLY_ALLOWLIST:
            raise ReadOnlyViolation(
                f"Zerodha connector is read-only (ADR-010): '{method}' is not "
                f"in the allowlist {sorted(_READ_ONLY_ALLOWLIST)}"
            )
        kite = self._client()
        return getattr(kite, method)(*args, **kwargs)

    def _client(self):
        if self._kite is not None:
            return self._kite
        try:
            from kiteconnect import KiteConnect  # noqa: PLC0415
        except ImportError as exc:
            raise BrokerConnectionError(
                "kiteconnect is not installed — `pip install kiteconnect` "
                "(it's in the server's optional deps)."
            ) from exc
        api_key = os.environ.get(ENV_API_KEY)
        token = _load_token()
        if not api_key or not token or not token.get("access_token"):
            raise BrokerConnectionError(
                "no Kite session — set KITE_API_KEY and run "
                "`--broker zerodha --auth` for the daily access token."
            )
        kite = KiteConnect(api_key=api_key)
        kite.set_access_token(token["access_token"])
        self._kite = kite
        return kite

    # -- BrokerConnection protocol -------------------------------------------

    def fetch_positions(self, account_number: str) -> list[dict]:
        """Delivery holdings normalized to base.Position dicts (INR, .NS/.BO
        symbols). account_number is unused (Kite scopes to the authed user)."""
        holdings = self._call("holdings") or []
        out: list[dict] = []
        for h in holdings:
            qty = float(h.get("quantity", 0) or 0)
            if qty == 0:
                continue
            out.append({
                "symbol": display_symbol(
                    str(h.get("tradingsymbol", "")), str(h.get("exchange", "NSE"))),
                "shares": qty,
                "avg_cost": float(h.get("average_price", 0) or 0),
                "current_price": float(h.get("last_price", 0) or 0) or None,
            })
        return out

    def fetch_portfolio(self, account_number: str) -> dict:
        """Account summary: total holdings market value in INR."""
        holdings = self._call("holdings") or []
        total = sum(
            float(h.get("last_price", 0) or 0) * float(h.get("quantity", 0) or 0)
            for h in holdings
        )
        return {"total_value": round(total, 2), "currency": "INR"}

    @staticmethod
    def _kite_for_auth():
        """A KiteConnect client for the login/exchange flow (needs api_key +
        api_secret from host env)."""
        try:
            from kiteconnect import KiteConnect  # noqa: PLC0415
        except ImportError as exc:
            raise BrokerConnectionError("kiteconnect not installed.") from exc
        api_key = os.environ.get(ENV_API_KEY)
        api_secret = os.environ.get(ENV_API_SECRET)
        if not api_key or not api_secret:
            raise BrokerConnectionError(
                f"set {ENV_API_KEY} and {ENV_API_SECRET} (from your Kite Connect app).")
        return KiteConnect(api_key=api_key), api_secret

    def login_url(self) -> str:
        """The Kite login URL to open. After login Kite redirects to the app's
        registered redirect URL with ?request_token=… — the web callback (or the
        CLI paste) feeds that to :meth:`exchange_request_token`."""
        kite, _ = self._kite_for_auth()
        return kite.login_url()

    def exchange_request_token(self, request_token: str) -> dict:
        """Exchange a request_token for an access_token and persist it. Returns
        a small non-secret status dict. Raises on an invalid/expired token."""
        kite, api_secret = self._kite_for_auth()
        session = kite.generate_session(request_token.strip(), api_secret=api_secret)
        _save_token({"access_token": session["access_token"],
                     "public_token": session.get("public_token"),
                     "login_time": str(session.get("login_time", ""))})
        self._kite = None  # force a rebuild with the fresh token on next call
        return {"login_time": str(session.get("login_time", "")), "saved": True}

    def interactive_auth(self) -> None:
        """CLI daily login: print the Kite login URL, read the pasted
        request_token, exchange + persist it."""
        print(f"Open this URL, log in, and copy the request_token from the "
              f"redirect:\n  {self.login_url()}")
        self.exchange_request_token(input("request_token: ").strip())
        print("Kite access token saved (valid until the next ~06:00 IST rollover).")

    def auth_status(self) -> str:
        token = _load_token()
        if not token or not token.get("access_token"):
            return "needs --auth (no Kite access token; tokens expire ~06:00 IST daily)"
        when = token.get("login_time") or "unknown time"
        return f"grant present (logged in {when}; expires next ~06:00 IST)"

    # Kite has no separate account-number concept for read; declared explicitly.
    def account_numbers(self) -> list[str]:
        raise NotSupported("Kite scopes to the authenticated user — no account list.")
