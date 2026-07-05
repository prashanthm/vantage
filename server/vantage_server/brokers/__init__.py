"""Broker integrations for the operator-side importer CLI.

Everything under this package is OUTSIDE the read-only service surface
(ADR-010) in the same sense as the CSV importer: only the operator's CLI
touches it, and even then the broker connection itself is read-only by a
hard allowlist (see robinhood.READ_TOOLS).
"""
