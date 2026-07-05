# Income Ideas Screener — Spec

> **Feature slug:** income-ideas-screener
> Product doc: [initiatives/vantage/features/income-ideas-screener.md](../../initiatives/vantage/features/income-ideas-screener.md)
> Siblings: [`plan.md`](./plan.md) (files/steps/ADRs/edge-cases) · [`tasks.md`](./tasks.md) (granular units + Loop AC)

> Joined to its GitHub issue by slug + branch; the implementing PR lands with `Closes owner/repo#N`. No issue number stored in this file.

## Behavior / What

A table of income ideas generated against actual holdings and cash per account: covered calls (100+ share lots), cash-secured puts (idle cash), each with backing, contract, delta, premium, annualized yield, eligibility gaps, approval-level caveats, and a TLH cross-check card.

## Acceptance Criteria

- [ ] Every idea names backing + account
- [ ] Not-yet-eligible positions show the gap
- [ ] Approval caveat on restricted accounts
- [ ] Assignment-wash warning ties to Tax Center

## Out of Scope

- Real chains/greeks; auto-refresh of ideas.

## ADRs Applied

- ADR-008 (wash cross-check)
- ADR-010 (never staged as orders)

## Task Breakdown

> Granular units live in [`tasks.md`](./tasks.md); each carries a `## Loop AC` block of behavioral
> `verify:` commands the loop runs. Backfill note: this spec was authored against the implemented
> prototype — Loop AC verify the shipped behavior.
