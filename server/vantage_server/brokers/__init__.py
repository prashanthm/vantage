"""Broker connections for the operator-side importer CLI.

Everything under this package is OUTSIDE the read-only service surface
(ADR-010) in the same sense as the CSV importer: only the operator's CLI
touches it, and even then every broker connection is read-only by a hard
transport-layer allowlist (the doctrine in base.py; robinhood.READ_TOOLS is
the reference implementation).

Each connection is one module implementing base.BrokerConnection and
registered with @base.register_connection. Importing this package imports
every connection module, which is what populates base.CONNECTIONS — add new
connector modules to the import list below.
"""
from .base import (  # noqa: F401
    CONNECTIONS,
    BrokerConnection,
    BrokerConnectionError,
    NotSupported,
    Position,
    ReadOnlyViolation,
    get_connection,
    register_connection,
)

# Importing a connection module registers it (all are import-light: optional
# heavy deps like `mcp` stay lazy inside the modules).
from . import robinhood  # noqa: E402,F401  — broker_id "robinhood"
from . import schwab  # noqa: E402,F401  — broker_id "schwab-api" (stub)
from . import aggregator  # noqa: E402,F401  — broker_id "fidelity-api" (stub)
from . import zerodha  # noqa: E402,F401  — broker_id "zerodha" (Kite, read-only, INR)
