# Vantage AI Chat — Spec

> **Feature slug:** vantage-ai-chat
> Product doc: [initiatives/vantage/features/vantage-ai-chat.md](../../initiatives/vantage/features/vantage-ai-chat.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A chat slide-over ('Vantage AI') answers portfolio questions with account-specific figures via keyword-matched canned rules, always falls back to a capability listing, and discloses demo/educational status.

## Acceptance Criteria

- [ ] Wash/TLH/overlap/allocation rules answer with real dataset figures
- [ ] Catch-all fallback exists
- [ ] Demo + educational disclosure in panel
- [ ] DS FormField + Button compose the input row

## Out of Scope

- Real LLM backend (future: Mira framework).

## ADRs Applied

- ADR-011
- ADR-010 (chat never offers to execute)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
