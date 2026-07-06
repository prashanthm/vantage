"""Schwab Trader API connector — REGISTERED STUB (compiles, not yet wired).

WHY THIS EXISTS: TD Ameritrade's retail API was retired in May 2024 after the
Schwab acquisition; former TDA accounts (and native Schwab accounts) are now
served by the **Schwab Trader API** on https://developer.schwab.com. This
module is the drop-in point for that integration — the importer already
offers ``--broker schwab-api`` and fails with a pointer here until the TODOs
below are implemented. (The zero-dependency path meanwhile remains the
``--broker schwab`` positions-CSV parser in importer.py.)

AUTH (TODO): OAuth 2.0 authorization-code flow against
https://api.schwabapi.com/v1/oauth/authorize + /v1/oauth/token, using an app
registered on developer.schwab.com. Env conventions:

- ``SCHWAB_APP_KEY``    — the app (client) key from the developer portal;
- ``SCHWAB_APP_SECRET`` — the app secret;
- ``SCHWAB_TOKEN_FILE`` — token-file override, mirroring robinhood_auth's
  resolution (env override > in-repo default ``server/.schwab_token.json``),
  saved atomically with chmod 600, values never printed or logged.

Schwab quirk to handle: the redirect URI must be HTTPS (https://127.0.0.1
works for a local one-time flow) and access tokens live ~30 minutes with
7-day refresh tokens — auto-refresh in get_access_token() style.

ENDPOINTS (TODO — the read-only surface to allowlist):

#   GET https://api.schwabapi.com/trader/v1/accounts/accountNumbers
#       -> [{accountNumber, hashValue}]  (all further calls use hashValue)
#   GET https://api.schwabapi.com/trader/v1/accounts/{hashValue}?fields=positions
#       -> securitiesAccount.positions[]: {instrument.symbol, longQuantity,
#          averagePrice, marketValue}  -> normalize to base.Position
#   GET https://api.schwabapi.com/trader/v1/accounts/{hashValue}
#       -> securitiesAccount.currentBalances.liquidationValue -> total_value

READ-ONLY DOCTRINE (ADR-010, non-negotiable — see brokers/base.py): the real
implementation MUST route every HTTP call through one dispatcher with a
frozen allowlist of the GET endpoints above and refuse anything else with
ReadOnlyViolation before network I/O. The Trader API also exposes order
placement under /accounts/{hash}/orders — that path must never appear in
this module, and a unit test must prove the refusal.
"""
from __future__ import annotations

from .base import register_connection

_STUB_MSG = (
    "the Schwab Trader API connector is a stub — see the TODOs in "
    "vantage_server/brokers/schwab.py (OAuth app on developer.schwab.com, "
    "SCHWAB_APP_KEY/SCHWAB_APP_SECRET, /trader/v1 endpoints). "
    "Until then, use the CSV path: --broker schwab <positions.csv>"
)


@register_connection
class SchwabConnection:
    """Stub BrokerConnection for the Schwab Trader API (ex-TD Ameritrade)."""

    broker_id = "schwab-api"
    display_name = "Schwab Trader API"

    def fetch_positions(self, account_number: str) -> list[dict]:
        raise NotImplementedError(_STUB_MSG)

    def fetch_portfolio(self, account_number: str) -> dict:
        raise NotImplementedError(_STUB_MSG)

    def interactive_auth(self) -> None:
        raise NotImplementedError(_STUB_MSG)

    def auth_status(self) -> str:
        return "stub — no credential logic yet (see vantage_server/brokers/schwab.py)"
