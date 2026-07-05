# Account Aggregation

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | account-aggregation |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Investors with multiple brokerage accounts (taxable, Roth IRA, 401(k), robo) have no single place to see what they actually own. Totals, allocation, and exposure live in four different broker UIs with four different conventions, so the consolidated picture — the only one that matters for risk and tax — never exists.

## What We're Building

The account layer of Vantage: a linked-accounts model, a persistent account-scope selector (each account or "All accounts"), and consolidated portfolio views — total value, day/unrealized P/L, allocation vs targets, and a cross-account holdings table with per-lot drill-down — that re-derive instantly when the scope changes.

## Who It's For

Self-directed investors and traders holding two or more brokerage accounts.

## Value

- One consolidated, always-consistent view of everything owned, replacing per-broker tab-hopping.
- Per-account scoping makes every downstream surface (tax, recommendations, intelligence) account-aware for free.
- Lot-level fidelity (date, cost, term) is the substrate every tax computation needs.

## Acceptance Criteria

- [ ] Switching scope between any account and "All accounts" re-derives totals, allocation, and holdings with no stale values.
- [ ] The holdings table shows combined positions with per-account chips and expands to per-lot rows (date, cost, term).
- [ ] Allocation renders by asset class with drift-vs-target badges at ≥3-point deviation (consolidated scope).
- [ ] All values derive from the single lots table at render time — no stored aggregates (ADR-007).

## Features

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| Accounts & scope rail | accounts-scope-rail | Linked-accounts model + sidebar scope selector | Phase 1 — Core |
| Portfolio overview | portfolio-overview | Stat tiles + allocation bar with drift badges | Phase 1 — Core |
| Consolidated holdings | consolidated-holdings | Cross-account positions table with per-lot expansion | Phase 1 — Core |

## Future Enhancements

- Real account linking (after ADR-013 ratifies the aggregation approach).
- Household/spouse account grouping (matters for wash-sale correctness) — after live data ships.

## Additional Context

### Relevant ADRs

- [ADR-007](../adrs/007-pure-function-portfolio-math.md) — all aggregation is derived, never stored.
- [ADR-005](../adrs/005-hash-routed-sidebar-views.md) — scope selector is pinned in the sidebar shell.
- [ADR-013](../adrs/013-live-data-backend.md) — Proposed; live account linking deferred pending it.
