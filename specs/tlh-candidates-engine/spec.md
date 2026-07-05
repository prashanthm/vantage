# TLH Candidates Engine — Spec

> **Feature slug:** tlh-candidates-engine
> Product doc: [initiatives/vantage/features/tlh-candidates-engine.md](../../initiatives/vantage/features/tlh-candidates-engine.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A pure function classifies every losing lot: N/A (tax-advantaged account), below-threshold, clear, or wash-blocked; suggests different-index replacements from the partner map; and estimates after-tax benefit at the settings marginal rate.

## Acceptance Criteria

- [ ] Each losing lot gets exactly one status
- [ ] Thresholds come from settings ($ and %)
- [ ] Partner-map replacement or 31-day-wait instruction
- [ ] Benefit = harvestable loss x marginal rate

## Out of Scope

- Realized gain/loss ledger; multi-year carryforward math.

## ADRs Applied

- ADR-008 (model)
- ADR-006 (frozen clock)
- Inherited: Sentinel ADR-007/008

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
