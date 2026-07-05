# AI Market Summary — Spec

> **Feature slug:** ai-market-summary
> Product doc: [initiatives/vantage/features/ai-market-summary.md](../../initiatives/vantage/features/ai-market-summary.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

Market Intel renders a per-symbol AI read: symbol pills, bias badge (Bullish/Neutral/Bearish), momentum + sentiment meters with visible values, a level-aware summary, and an AI picks table whose rows click through to the read.

## Acceptance Criteria

- [ ] Symbol switch swaps read in place
- [ ] Three-state bias badge styling
- [ ] Meters render 0-100 with values
- [ ] Picks click through when a read exists

## Out of Scope

- Real model inference; news feed.

## ADRs Applied

- ADR-006 (fixtures)
- ADR-011

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
