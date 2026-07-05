# Portfolio Overview — Spec

> **Feature slug:** portfolio-overview
> Product doc: [initiatives/vantage/features/portfolio-overview.md](../../initiatives/vantage/features/portfolio-overview.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

The Overview view renders four stat tiles (total value, day P/L, unrealized P/L, harvestable losses + est. benefit) and an asset-class allocation bar with legend and drift-vs-target badges, all derived from the current scope.

## Acceptance Criteria

- [ ] Four stat tiles re-derive on scope change
- [ ] Allocation bar uses validated categorical palette with labels
- [ ] Drift badges only in consolidated scope at >=3pt deviation
- [ ] Benefit note derives from settings tax rate

## Out of Scope

- Charts/sparklines in tiles; YTD performance (needs history).

## ADRs Applied

- ADR-007 (derived)
- ADR-004 (palette discipline)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
