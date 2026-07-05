# Accounts & Scope Rail — Spec

> **Feature slug:** accounts-scope-rail
> Product doc: [initiatives/vantage/features/accounts-scope-rail.md](../../initiatives/vantage/features/accounts-scope-rail.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A sidebar rail lists every linked account (name, type, sync status, lot-derived balance) plus an 'All accounts' consolidated entry. Selecting an entry sets the app-wide account scope; every consuming view re-derives. A read-only/no-orders note renders in the rail.

## Acceptance Criteria

- [ ] Rail lists all accounts + consolidated entry with derived balances
- [ ] Selecting an entry updates shared scope state consumed by all views
- [ ] Read-only note visible (ADR-010 surface)

## Out of Scope

- Real account linking (ADR-013); household/spouse grouping.

## ADRs Applied

- ADR-005 (sidebar shell)
- ADR-007 (derived balances)
- ADR-010 (read-only note)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
