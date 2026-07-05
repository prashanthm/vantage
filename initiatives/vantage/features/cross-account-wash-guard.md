# Cross-Account Wash Guard

> Part of epic: [tax-intelligence](../epics/tax-intelligence.md)
> **Slug:** cross-account-wash-guard

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The wash-sale window computation across every linked account: a 30-day look-back over actual buys (including DRIPs and payroll contributions) and a look-forward over scheduled auto-buys, evaluated against substantially-identical families, producing blocked statuses with the offending account, transaction, and clear date.

## Why

Satisfies tax-intelligence AC 2 — the cross-account guarantee that is the product's differentiator; single-account tools cannot produce this status.

## Acceptance Criteria

- [ ] A buy of a same-family symbol in ANY account within 30 days blocks the harvest and the status names the account, transaction, and date the window clears.
- [ ] A scheduled auto-buy within the next 30 days also blocks, with a pause-the-auto-buy remediation hint.
- [ ] Tax-advantaged accounts trigger blocks for taxable lots (Rev. Rul. 2008-5 direction) even though they cannot harvest.
- [ ] Same-index families wash each other; different-index partners (e.g. VOO→VTI) do not.

## Depends On

- [tlh-candidates-engine](tlh-candidates-engine.md). ADR-008, ADR-006 (frozen-clock fixtures).

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/cross-account-wash-guard/`.
