# Chart Recommendation Panel — Spec

> **Feature slug:** chart-recommendation-panel
> Product doc: [initiatives/vantage/features/chart-recommendation-panel.md](../../initiatives/vantage/features/chart-recommendation-panel.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

Beside the chart: the AI read (bias/meters/summary), 'Your position' (aggregated shares/value/unrealized + per-lot account rows, with an avg-cost line on the chart when held; 'Not held' otherwise), and an AI recommendation card with action, portfolio-aware rationale, and a risk line, plus a markers-education FAQ.

## Acceptance Criteria

- [ ] Held symbols show position + avg-cost line
- [ ] Unheld symbols say Not held
- [ ] Recommendation card has action/rationale/risk
- [ ] Education FAQ present

## Out of Scope

- Order staging of any kind (ADR-010).

## ADRs Applied

- ADR-008 (tax-date-aware recs)
- ADR-011
- ADR-010

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
