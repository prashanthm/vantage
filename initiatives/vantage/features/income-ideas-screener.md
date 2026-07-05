# Income Ideas Screener

> Part of epic: [options-intelligence](../epics/options-intelligence.md)
> **Slug:** income-ideas-screener

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The against-your-book income screener: covered-call candidates from 100+-share positions and cash-secured-put candidates from idle cash, per account — each idea naming its backing, contract, delta, premium, and annualized yield, with eligibility gaps ("60 of 100 shares"), account approval-level caveats, and TLH cross-checks (assignment can wash a planned harvest).

## Why

Satisfies options-intelligence AC 1 (backing + terms per idea), AC 2 (approval caveats), and AC 3 (TLH cross-check) — the epic's differentiating behavior.

## Acceptance Criteria

- [ ] Every idea names backing shares/cash and the specific account; no idea is account-less.
- [ ] Positions below the 100-share threshold surface as "not yet eligible" with the gap and the unlocked premium estimate.
- [ ] Ideas in accounts that typically disallow options carry an explicit caveat.
- [ ] At least one surfaced warning ties assignment risk to the Tax Center's wash logic.

## Depends On

- [consolidated-holdings](consolidated-holdings.md), [cross-account-wash-guard](cross-account-wash-guard.md). ADR-008, ADR-010.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/income-ideas-screener/`.
