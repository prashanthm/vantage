# Recommendations Feed — Spec

> **Feature slug:** recommendations-feed
> Product doc: [initiatives/vantage/features/recommendations-feed.md](../../initiatives/vantage/features/recommendations-feed.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

The Recommendations view renders six accent-coded cross-account insight cards (harvest, pause-auto-buy, concentration, overlap, rebalance-by-contribution, cash drag) with rationale and quantified impact where available; top actions also surface on Overview; TLH figures come from the shared engine.

## Acceptance Criteria

- [ ] Six insight cards with distinct accents
- [ ] Quantified cards re-derive from settings
- [ ] Overview shows top actions with link to full feed
- [ ] Options income teaser links to Options Intel

## Out of Scope

- Real ranking engine (prototype order is curated); dismissal/snooze.

## ADRs Applied

- ADR-011
- ADR-008 (consumes, never re-implements wash logic)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
