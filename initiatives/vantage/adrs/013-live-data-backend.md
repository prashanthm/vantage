# ADR-013: Live data backend & broker aggregation

## Status

Accepted

## Context

Phase 3 (live-data) replaces the mock module with real quotes and real read-only account data. This was the initiative's largest unmade decision: it introduces the first server, the first (eventual) credentials, and the first third-party data dependency — deferred behind ADR-012 until ratified. The Mira⇄Vantage integration forced the ratification: an external AI system needs the same portfolio numbers the SPA renders, and duplicating the math on the AI side would fork the engine.

## Decision Drivers

1. Quote feed options span free-tier (yfinance/stooq-class, as sentinel uses), paid market-data APIs, and broker-provided data — differing in licensing, reliability, and rate limits.
2. Account aggregation options: aggregator APIs (Plaid-class), per-broker APIs, or manual lots-file import (sentinel's current model) — differing enormously in credential risk and coverage.
3. ADR-010 constrains every option to read-only scopes; any aggregator credential must be incapable of trading.
4. The module boundary is already cut for the swap: everything consumes `src/data.js` exports and `genOHLC()` — the decision is about what fills that boundary, not app rework.
5. New driver: Mira (the household's AI system) must consume portfolio math without reimplementing it — one deterministic engine, two consumers.

## Research & Rubric

Sentinel-parity direction adopted without an aggregator bake-off (rubric applied: credential risk, read-only enforceability, coverage of the four account types, cost, licensing). Manual JSON dataset + free quote feed scores zero-credential-risk and full read-only enforceability; aggregator APIs remain a future superseding decision.

## Decision

Vantage owns a deterministic backend (`server/`) that fills the `src/data.js` boundary via REST; AI consumes the same engine via the MCP tool surface; Mira (AI-only) performs no portfolio math.

Concretely:

- A Python 3.12 service (`server/vantage_server/`) owns all deterministic portfolio management/algorithms — positions, allocation, overlap, cross-account wash-sale windows, TLH candidates — as pure functions porting `src/util.jsx` semantics exactly (which in turn inherit sentinel's `tlh_monitor.py` model; where the two differ, `util.jsx` wins).
- Data is a JSON-file dataset (sentinel lots-file model, plus the account dimension) read from `VANTAGE_DATA_DIR`, defaulting to a fixture mirroring `src/data.js` — zero credentials.
- Quotes are fixture-first (deterministic); an opt-in free delayed feed (stooq, stdlib urllib, no credentials) degrades back to fixture with a `stale` flag on any failure.
- Two read-only surfaces over the one engine: REST `/api/*` on :8641 for the SPA, and MCP `vantage.*` tools on :8640 for Mira. Architecture details are ADR-014's scope.
- Aggregator APIs (Plaid-class) are evaluated only after this ships, as a superseding ADR.

## Consequences

### Becomes Easier

- The same views run on real data with the swap contained at the data-module boundary (SPA wiring is Phase V4).
- Mira grounds every portfolio answer on tool results from the one engine — no math fork, no drift between what the SPA shows and what the AI says.
- Parity is testable: the fixture dataset mirrors `src/data.js`, so golden tests pin the engine to the SPA's numbers.

### Becomes Harder

- Two runtimes to keep semantically aligned until Phase V4 retires the SPA's local math; the parity goldens are the guard.
- A server now exists: ADR-012's "no server components" posture is superseded for the backend (the SPA itself remains static).

## Applies To

- live-data-platform epic (features unblocked); ADR-006, ADR-009, ADR-010, ADR-012, ADR-014.
