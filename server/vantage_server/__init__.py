"""Vantage backend — the deterministic portfolio engine (ADR-013/ADR-014).

Two read-only surfaces over one engine:
  - REST  (vantage_server.api)        for the SPA, port 8641
  - MCP   (vantage_server.mcp_server) for Mira/AI,  port 8640

All deterministic portfolio math lives in vantage_server.engine (pure
functions); store/quotes do the I/O. No mutation surface exists (ADR-010).
"""

__version__ = "0.1.0"
