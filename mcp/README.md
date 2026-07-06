# vantage-mcp

The **AI-facing MCP tool surface** for Vantage — its own project, depending on the
`vantage-server` engine package (`../server`) but with an independent lifecycle.
Mira (the AI layer) consumes these tools; it performs no portfolio math of its own.

Serves `vantage.*` read-only tools (positions, allocation, wash_status,
tlh_candidates, lots, quotes, signals, history, strategies) over MCP streamable
HTTP on `127.0.0.1:8640/mcp`. Every result carries a provenance block so AI
answers can attribute every number.

`vantage.strategies` returns the options strategy roll-up (importer
`--with-strategies`): `open` strategies netted from current positions (short
legs INCLUDED, unlike the lots view) and `closed` per-order rows from option
order history. Filter by `account` (open rows) and `status` (open|closed|all).

```bash
make setup     # venv + editable install of ../server and this package
make test      # in-memory MCP session round-trips (no network)
make run       # serve on :8640 (fixture quotes)
make run-live  # serve with the delayed Stooq quote feed
```

Prefer `../stack start` to run the whole stack (API + MCP + SPA + Mira) at once.

Why separate from `server/`: the REST API is the product surface (SPA-facing),
this is the AI integration surface — different consumers, different release
cadence, and this project can be extracted to its own repo without touching the
engine (its only coupling is the installable `vantage-server` package).
