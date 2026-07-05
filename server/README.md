# Vantage backend (`server/`)

The deterministic portfolio engine behind Vantage (ADR-013/ADR-014). One pure
engine (`vantage_server/engine.py` — positions, allocation, overlap,
cross-account wash-sale windows, TLH candidates), exposed two ways:

- **REST** (`vantage_server/api.py`) — `/api/*` for the SPA.
- **MCP** (`vantage_server/mcp_server.py`) — `vantage.*` tools for Mira, the
  AI side. Mira performs **no portfolio math**; it calls these tools and every
  result carries a provenance block for grounding/attribution.

The service is **read-only by construction** (ADR-010): every REST route is
GET, every MCP tool declares `readOnlyHint`, and no order-placement or
fund-movement code path exists anywhere in the package.

## Ports

| Port | What | Where |
|------|------|-------|
| 8640 | MCP tool server (streamable HTTP, path `/mcp`) | `make run-mcp` |
| 8641 | REST API for the SPA | `make run-api` |
| 8642 | Vantage SPA (static, repo root) | `python3 -m http.server 8642` |
| 8080 | Mira (external AI system, MCP client) | not in this repo |

## Run

```sh
make setup     # create server/.venv (Python 3.12, uv if available) + editable install
make test      # pytest: engine units, parity goldens, API contract, MCP round-trips
make run-api   # uvicorn on http://127.0.0.1:8641  (GET /api/health to check)
make run-mcp   # MCP streamable HTTP on http://127.0.0.1:8640/mcp
```

## Data

`VANTAGE_DATA_DIR` points at a directory of JSON files (`accounts.json`,
`lots.json`, `recent_buys.json`, `auto_buys.json`, `partner_map.json`,
`quotes.json`); the default is `server/data/` — a fixture dataset that mirrors
the SPA's `src/data.js` **exactly** (same symbols, same numbers, same frozen
`as_of` of 2026-07-05 09:30 ET), which is what makes the parity golden tests
possible.

Quotes default to the deterministic fixture provider. Set `VANTAGE_QUOTES=stooq`
to overlay free delayed prices from stooq.com (stdlib urllib, no credentials);
any provider failure degrades back to fixture prices with `"stale": true`.
Every REST payload and MCP tool result carries `{"as_of", "source"}` so
consumers always know what data they are looking at.

## Semantics

The engine ports `src/util.jsx` (the product's current spec) faithfully —
thresholds `$200` / `3%` (either qualifies a loss), 30-day wash window in both
directions, cross-account including IRAs (Rev. Rul. 2008-5),
substantially-identical families, different-index partner map, auto-buy
look-ahead. Where `util.jsx` and sentinel's `tlh_monitor.py` differ, `util.jsx`
wins; the differences and resolutions are documented at the top of
`vantage_server/engine.py`.

## Integration notes

- The SPA (Phase V4) will swap its `src/data.js` mock boundary for `/api/*`;
  until then the SPA keeps running purely on the mock module — nothing under
  `src/` depends on this server.
- Mira connects as an MCP client to `http://127.0.0.1:8640/mcp` and gets the
  same numbers the SPA renders, from the same engine.
