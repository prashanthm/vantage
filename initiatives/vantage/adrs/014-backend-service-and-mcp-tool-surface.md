# ADR-014: Backend service architecture & MCP tool surface

## Status

Accepted

## Context

ADR-013 ratified that Vantage owns a deterministic backend and that Mira (the external AI system) performs no portfolio math. This ADR fixes the architecture of that backend: how the one engine is packaged, how its two consumers (the SPA and Mira) reach it, and how ADR-010's read-only guarantee survives the introduction of the first server.

## Decision Drivers

1. One engine, two consumers: the SPA needs JSON over HTTP; Mira needs typed, discoverable tools with provenance it can ground/attribute answers on. Neither consumer may recompute portfolio math.
2. ADR-010 is binding: the service must be read-only by construction — absence of code paths, not configuration.
3. Determinism first (ADR-006 lineage): tests and demos need reproducible numbers; live quotes are an opt-in overlay, never a dependency.
4. Purity boundary (ADR-007 lineage): the math must stay pure functions so it is unit-testable and I/O failures cannot corrupt results.
5. MCP is the emerging standard for exposing tools to AI systems; Mira already speaks it.

## Research & Rubric

No options weighed on the surface protocols (REST for the SPA and MCP for AI are the respective defaults); the quote-provider rubric from ADR-013 (credential risk, determinism, cost) selected fixture-first with a free credential-less overlay.

## Decision

`server/` is a self-contained Python 3.12 package (`vantage_server`, own venv, `make -C server setup/test/run-api/run-mcp`) with a strict layering:

- **`engine.py`** — the deterministic engine: pure functions (no I/O) porting `src/util.jsx` semantics exactly (positions, allocation, overlap, `washStatus` with 30-day window both directions, cross-account incl. IRAs, substantially-identical families, auto-buy look-ahead; `tlhCandidates` with $200/3% either-threshold and partner-map replacements). Divergences from sentinel's `tlh_monitor.py` are documented in the module docstring; `util.jsx` wins.
- **`store.py` / `quotes.py`** — all I/O. JSON-file dataset from `VANTAGE_DATA_DIR` (default `server/data/`, an exact mirror of `src/data.js` enabling parity goldens), validated with explicit errors. Quotes are fixture-first; `VANTAGE_QUOTES=stooq` opts into free delayed CSV over stdlib urllib, and any provider failure degrades to fixture with `stale: true`.
- **REST surface (`api.py`)** — FastAPI on **:8641**: `/api/health`, `/api/accounts`, `/api/positions`, `/api/allocation`, `/api/lots`, `/api/tax/wash`, `/api/tax/tlh`, `/api/quotes`. GET only — no mutating route exists; CORS admits `http://localhost:*` (SPA on :8642). Every payload carries `{"as_of", "source"}`.
- **MCP surface (`mcp_server.py`)** — FastMCP streamable HTTP on **:8640** path `/mcp`: tools `vantage.positions`, `vantage.allocation`, `vantage.wash_status`, `vantage.tlh_candidates`, `vantage.lots`, `vantage.quotes` — flat input schemas, `readOnlyHint` annotations, and a provenance block `{"source_type": "vantage", "source_id": "<data-dir>#<dataset>"}` on every result so Mira (:8080) can attribute every number.
- **Port table**: 8640 MCP · 8641 REST · 8642 SPA · 8080 Mira.
- Rejected: **letting Mira compute from raw lots** — forks the engine, breaks the single-source-of-truth guarantee. Rejected: **one surface for both consumers** — the SPA would carry MCP framing overhead, or Mira would lose typed tool discovery and provenance.

## Consequences

### Becomes Easier

- ADR-010 stays auditable by inspection: no POST/PUT/DELETE route and no non-read-only tool exists anywhere in the package; the test suite asserts both.
- Parity goldens pin the Python engine to hand-traced `util.jsx` values over the shared fixture dataset — semantic drift fails CI.
- New AI consumers get the engine for free by speaking MCP; new UI consumers get it via REST.

### Becomes Harder

- Two surfaces to version in lockstep with the engine's output shapes.
- The fixture dataset must track `src/data.js` until Phase V4 inverts the dependency (SPA reads the API).

## Applies To

- `server/` in its entirety; Mira⇄Vantage integration phases V2/V4; ADR-007, ADR-010, ADR-013.

## Implemented (V4) — SPA wiring

Phase V4 landed the REST-consumer side: `src/live.js` is the SPA's integration adapter (plain `fetch`/`ReadableStream`, no dependencies) with per-endpoint clients, payload→view-shape mappers, a `useLive` progressive-enhancement hook, and the Mira clients (`/insights?domain=advisor`, `/turn` SSE streaming for chat). Overview, Holdings, and the Tax Center now read the `:8641` API when reachable and keep `src/data.js` fixtures as the automatic fallback (timeout ~2.5s, any failure → fixtures, zero console errors); the backend/Mira URLs and the Mira/Off toggle live in Settings under the unchanged `vantage.settings.v1` key (ADR-009), and sidebar status dots surface live/demo provenance from each payload's `{"as_of","source"}` envelope. The "fixture dataset must track `src/data.js`" consequence above is thereby on its planned path to inversion — the SPA prefers the API and only the fallback still depends on the mirrored fixtures.

## Implemented (V5) — importer CLI, quote cache, computed signals

Phase V5 extended the backend within the same layering, without touching the read-only guarantee:

- **Broker lots importer** (`vantage_server/importer.py`, `python -m vantage_server.importer`) — operator-side **file management deliberately outside the read-only API surface**: the REST/MCP surfaces still expose no mutating path (mutating HTTP methods keep returning 405); only the operator's CLI writes the data directory, exactly as hand-editing the JSON would. Tolerant parsers for Fidelity/Schwab/Vanguard positions exports plus a `generic` internal-shape CSV; `--merge` (default, per-account) vs `--replace`; every write is preceded by a timestamped `lots.json.bak-<ISO>` backup (injectable clock for tests); `--dry-run` writes nothing; unknown accounts abort with exit 2 (`--add-account` appends to `accounts.json` in the same run); exports without acquisition dates require `--as-of` for determinism.
- **Quote cache** (`quotes.py`) — successful Stooq fetches persist to `<data_dir>/quotes_cache.json` with `fetched_at` and are reused for `VANTAGE_QUOTES_TTL` seconds (default 900, `0` bypasses) so repeated reads don't hammer the free feed; clock and `urlopen` are both injectable, keeping every test off the network. Per-symbol `N/D` fallback to fixture prices marks the snapshot `stale`. `make run-api-live` / `run-mcp-live` wrap `VANTAGE_QUOTES=stooq`.
- **Computed signals** (`signals.py`, `data/signals.json`, `GET /api/signals`, MCP `vantage.signals`) — the seed file carries only authored facts (entry/target/stop, pattern, confidence); **status is computed from the current quote snapshot on every read, never authored** (the loader rejects a stored `status` field). Pure `grade_signals` in engine style: direction implied by target vs entry, `open`/`hit_target`/`stopped`/`unquoted`, P/L % signed by direction, progress grade A–F against the entry→target move and halfway-to-stop line. Both surfaces stay read-only and keep the `{as_of, source}` + provenance envelopes.


## Implemented (V6) — project split + stack lifecycle

The MCP tool surface moved out of `server/` into its own project `mcp/`
(`vantage-mcp` package, own venv/Makefile/tests) depending on the installable
`vantage-server` engine — different consumers (AI vs SPA), independent release
cadence, extractable to its own repo without touching the engine. A root
`./stack` script (setup/start/stop/status/logs, port-based process control)
runs the four services — API :8641, MCP :8640, SPA :8642, Mira :8080 — with
one command each way.
