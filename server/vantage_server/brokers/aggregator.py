"""Fidelity-via-aggregator connector — REGISTERED STUB (compiles, not wired).

WHY THIS EXISTS: Fidelity offers NO retail-facing API — there is nothing to
OAuth against directly. The practical API path is an account **aggregator**
(SnapTrade, Plaid Investments, or similar) that fronts Fidelity through the
broker's data-sharing rails: the user links their Fidelity login in the
aggregator's hosted portal once, and this module then reads normalized
holdings from the aggregator's API. The importer already offers
``--broker fidelity-api`` and fails with a pointer here until the TODOs below
are implemented.

NOTE: the CSV importer (``--broker fidelity`` + a positions export) remains
the zero-dependency Fidelity path and is not going away — this connector is
for hands-off scheduled syncs.

AUTH (TODO): aggregator API keys (server-side), plus a per-user connection
established in the aggregator's hosted link flow. Env conventions:

- ``AGGREGATOR_CLIENT_ID``     — the aggregator API client id;
- ``AGGREGATOR_CLIENT_SECRET`` — the aggregator API secret;
- ``AGGREGATOR_TOKEN_FILE``    — cached user-connection ids/secrets, mirroring
  robinhood_auth's convention (env override > in-repo default
  ``server/.aggregator_token.json``), chmod 600, values never printed.

interactive_auth() should open the aggregator's hosted connection portal
(the one place the Fidelity credentials are ever typed — never into Vantage)
and persist the resulting connection/account ids.

ENDPOINTS (TODO — SnapTrade-flavored example of the read-only surface):

#   GET /api/v1/accounts                                   -> account list
#   GET /api/v1/accounts/{accountId}/positions
#       -> [{symbol.symbol, units, average_purchase_price, price}]
#          -> normalize to base.Position
#   GET /api/v1/accounts/{accountId}                       -> balance.total
#          -> fetch_portfolio()["total_value"]

READ-ONLY DOCTRINE (ADR-010, non-negotiable — see brokers/base.py): even
though aggregator credentials are typically data-only, the implementation
MUST still route every HTTP call through one dispatcher with a frozen
allowlist of the GET endpoints above and refuse anything else with
ReadOnlyViolation before network I/O (some aggregators expose trading APIs —
that surface must be unreachable from this module), with a unit test proving
the refusal.
"""
from __future__ import annotations

from .base import register_connection

_STUB_MSG = (
    "the Fidelity-via-aggregator connector is a stub — see the TODOs in "
    "vantage_server/brokers/aggregator.py (Fidelity has no retail API; a "
    "SnapTrade/Plaid-style aggregator with AGGREGATOR_CLIENT_ID/"
    "AGGREGATOR_CLIENT_SECRET is the path). "
    "Until then, use the CSV path: --broker fidelity <positions.csv>"
)


@register_connection
class AggregatorFidelityConnection:
    """Stub BrokerConnection for Fidelity behind an account aggregator."""

    broker_id = "fidelity-api"
    display_name = "Fidelity via aggregator"

    def fetch_positions(self, account_number: str) -> list[dict]:
        raise NotImplementedError(_STUB_MSG)

    def fetch_portfolio(self, account_number: str) -> dict:
        raise NotImplementedError(_STUB_MSG)

    def interactive_auth(self) -> None:
        raise NotImplementedError(_STUB_MSG)

    def auth_status(self) -> str:
        return "stub — no credential logic yet (see vantage_server/brokers/aggregator.py)"
