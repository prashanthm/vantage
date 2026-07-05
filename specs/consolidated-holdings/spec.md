# Consolidated Holdings — Spec

> **Feature slug:** consolidated-holdings
> Product doc: [initiatives/vantage/features/consolidated-holdings.md](../../initiatives/vantage/features/consolidated-holdings.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

The Holdings view renders combined positions for the scope: per-symbol aggregation with account chips, value/day/unrealized/weight, expandable per-lot rows (date, shares @ cost, term), overlap badges (consolidated scope only) and concentration badges for single stocks >7% weight.

## Acceptance Criteria

- [ ] Rows aggregate lots per symbol with account chips
- [ ] Row click toggles per-lot subrows with term (short/long)
- [ ] Overlap badge only in all-accounts scope
- [ ] Concentration badge for non-ETF weight > 7%

## Out of Scope

- Sorting controls, search/filter, CSV export.

## ADRs Applied

- ADR-007 (pure derivation)
- ADR-005 (dedicated view)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
