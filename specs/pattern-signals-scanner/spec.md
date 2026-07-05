# Pattern Signals Scanner — Spec

> **Feature slug:** pattern-signals-scanner
> Product doc: [initiatives/vantage/features/pattern-signals-scanner.md](../../initiatives/vantage/features/pattern-signals-scanner.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A signals table with Active/Past tabs (with counts): ticker, pattern, entry/target/stop, move %, confidence, and status badges; past signals always show hit-target or stopped outcomes.

## Acceptance Criteria

- [ ] Tabs filter with live counts
- [ ] Outcome badges on past signals
- [ ] Numeric columns tabular + signed move

## Out of Scope

- Real-time signal generation; alerts on signal fire (notifications epic).

## ADRs Applied

- ADR-006
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
