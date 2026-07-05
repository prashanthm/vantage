# Cross-Account Wash Guard — Spec

> **Feature slug:** cross-account-wash-guard
> Product doc: [initiatives/vantage/features/cross-account-wash-guard.md](../../initiatives/vantage/features/cross-account-wash-guard.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

washStatus(symbol) evaluates the 30-day wash window across ALL accounts: look-back over RECENT_BUYS (DRIPs, payroll, auto-invest) and look-forward over AUTO_BUYS schedules, using substantially-identical families; blocked results carry the offending account, transaction, and clear date.

## Acceptance Criteria

- [ ] Same-family recent buy in any account blocks with reason + clear date
- [ ] Scheduled auto-buy within 30 days blocks with pause hint
- [ ] Families wash each other; different-index partners do not
- [ ] Window constant is 30 days

## Out of Scope

- Spouse accounts; option-assignment wash detection (options epic surfaces the warning).

## ADRs Applied

- ADR-008 (the model this implements)
- ADR-006 (deterministic dates)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
