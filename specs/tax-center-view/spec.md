# Tax Center View — Spec

> **Feature slug:** tax-center-view
> Product doc: [initiatives/vantage/features/tax-center-view.md](../../initiatives/vantage/features/tax-center-view.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

The Tax Center screen renders every engine candidate as a table row (lot detail, account chip, unrealized, status badge, action), inlines block reasons and clear dates, includes a wash-sale education FAQ, and lights a sidebar dot when clear candidates exist.

## Acceptance Criteria

- [ ] Per-lot rows with status badges and action column
- [ ] Blocked rows show reason and clear date inline
- [ ] Education FAQ references current settings
- [ ] Sidebar dot iff a clear candidate exists

## Out of Scope

- Harvest execution of any kind (ADR-010).

## ADRs Applied

- ADR-010
- ADR-011
- ADR-005 (dedicated view)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
