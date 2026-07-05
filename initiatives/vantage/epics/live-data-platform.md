# Live Data Platform

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | live-data-platform |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Every Vantage surface currently runs on a deterministic mock. The product's claims (cross-account wash detection, income screening) only become real when real quotes and real (read-only) account data flow through the same views.

## What We're Building

The data platform that replaces `src/data.js` at its module boundary: a quote feed, account/lots ingestion (approach TBD — manual import vs aggregator API), and refresh mechanics — all read-only by construction (ADR-010).

## Who It's For

The same end users; operationally, the builder running it against household accounts.

## Value

- The prototype's demonstrated logic starts producing real, actionable dollar figures.
- The swap is contained at one module boundary, so the UI layer ships unchanged.

## Acceptance Criteria

- [ ] All seven views run against live quotes with no UI-layer changes beyond the data module swap.
- [ ] Account/lots data ingests via the ADR-013-ratified approach with read-only credentials only.
- [ ] Wash-window computations use the real calendar (frozen-clock fixture retired in live mode, retained for tests).

## Features

Features are **deferred pending ADR-013** (`Proposed — features deferred`). When ADR-013 is Accepted, run feature-generation against this epic to derive them (expected shape: quote-feed adapter, lots import, refresh scheduling, live/demo mode switch).

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| — | — | Deferred pending ADR-013 | Phase 3 — Live data |

## Future Enhancements

- Multi-user/auth (explicitly out of initiative scope; would be a new initiative).

## Additional Context

### Relevant ADRs

- [ADR-013](../adrs/013-live-data-backend.md) — Proposed — features deferred.
- [ADR-010](../adrs/010-read-only-decision-support.md), [ADR-012](../adrs/012-static-hosting-no-server.md) — constraints any chosen backend must satisfy.
