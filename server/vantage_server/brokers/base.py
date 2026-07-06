"""Pluggable broker-connection interface + registry.

A *broker connection* is one module in this package that talks to a broker's
API and yields normalized positions. The importer CLI knows nothing about any
specific broker: it looks the connection up in CONNECTIONS by ``--broker`` id
and drives it through the BrokerConnection protocol. Adding a broker is
therefore ONE new module here — implement the protocol, decorate the class
with @register_connection, and the importer (argparse choices included) picks
it up automatically. Nothing in importer.py changes.

THE READ-ONLY DOCTRINE (ADR-010) — a hard requirement for every module:

    Every connection MUST enforce read-only AT THE TRANSPORT LAYER, not by
    convention. The proven pattern is robinhood.py's: a single dispatcher
    that every remote call goes through, with an explicit frozen ALLOWLIST
    of read-only operations; anything outside it raises ReadOnlyViolation
    BEFORE any network I/O (and before importing any optional dependency).
    No order-placement, cancellation, or fund-movement code path may exist
    anywhere in a connection module — not even disabled or commented-in.
    New modules must ship a unit test proving the refusal path.

Auth conventions (mirror robinhood_auth.py): tokens live in a chmod-600 JSON
file, resolved env-var override first; token values are never printed or
logged — paths and expiries only.
"""
from __future__ import annotations

from typing import ClassVar, NotRequired, Protocol, TypedDict, runtime_checkable


class Position(TypedDict):
    """The normalized position shape every connection's fetch_positions emits
    (exactly what robinhood.py already produced)."""

    symbol: str          # upper-cased ticker
    shares: float        # current share count
    avg_cost: float      # AVERAGE cost basis per share (APIs rarely expose lots)
    current_price: NotRequired[float]  # only when the API payload carries one


def option_display_symbol(
    underlying: str, expiration: str, strike: float, option_type: str
) -> str:
    """Vantage's compact display symbol for one option contract:
    ``"<UND> <YYYY-MM-DD> <STRIKE><C|P>"`` e.g. ``"SPY 2026-07-17 750C"``.

    Used as the lot/quote symbol for imported option positions and as the
    history-row symbol, so both surfaces name a contract identically. The
    strike renders with %g (no trailing zeros: 750, 7.5)."""
    letter = "C" if str(option_type).lower().startswith("c") else "P"
    return f"{str(underlying).upper()} {expiration} {float(strike):g}{letter}"


class ReadOnlyViolation(Exception):
    """An attempt was made to invoke an operation outside a connection's
    read-only allowlist (the ADR-010 hard guarantee)."""


class NotSupported(Exception):
    """The connection does not support this optional operation
    (e.g. interactive_auth for an aggregator with hosted-portal auth)."""


class BrokerConnectionError(Exception):
    """Base class for a connection's runtime failures (auth, transport,
    unusable payloads). Subclass it so the importer can report broker
    problems as user-correctable errors instead of tracebacks."""


@runtime_checkable
class BrokerConnection(Protocol):
    """What every broker connection module must implement.

    Register the concrete class with @register_connection; its broker_id
    becomes the importer's ``--broker`` choice.
    """

    broker_id: ClassVar[str]      # importer --broker id, e.g. "robinhood"
    display_name: ClassVar[str]   # human name for messages, e.g. "Robinhood"

    def fetch_positions(self, account_number: str) -> list[dict]:
        """Current positions for the broker-side account, normalized to
        Position dicts ({symbol, shares, avg_cost, current_price?})."""
        ...

    def fetch_portfolio(self, account_number: str) -> dict:
        """Account-level summary. MUST include ``total_value`` when the API
        exposes one — the importer's --include-cash math depends on it."""
        ...

    def interactive_auth(self) -> None:
        """One-time grant flow (browser OAuth, key exchange, ...). May raise
        NotSupported when the broker has no interactive flow."""
        ...

    def auth_status(self) -> str:
        """Human-readable credential state: "grant valid", "needs --auth",
        ... Never includes token values."""
        ...


#: broker_id -> connection class. Populated by @register_connection at import
#: time (brokers/__init__.py imports every connection module).
CONNECTIONS: dict[str, type[BrokerConnection]] = {}


def register_connection(cls):
    """Class decorator: add a BrokerConnection implementation to CONNECTIONS."""
    broker_id = getattr(cls, "broker_id", None)
    if not broker_id or not isinstance(broker_id, str):
        raise ValueError(f"{cls.__name__} must define a non-empty broker_id class attr")
    if broker_id in CONNECTIONS:
        raise ValueError(
            f"duplicate broker_id '{broker_id}': {cls.__name__} vs "
            f"{CONNECTIONS[broker_id].__name__}"
        )
    CONNECTIONS[broker_id] = cls
    return cls


def get_connection(broker_id: str) -> type[BrokerConnection]:
    """Look up a registered connection class by broker_id."""
    try:
        return CONNECTIONS[broker_id]
    except KeyError:
        raise ValueError(
            f"unknown broker connection '{broker_id}' — registered connections: "
            f"{sorted(CONNECTIONS)}"
        ) from None
