# Tax Center View

> Part of epic: [tax-intelligence](../epics/tax-intelligence.md)
> **Slug:** tax-center-view

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The Tax Center screen: a per-lot table rendering the engine's classifications with status badges, block reasons, and recommended actions; a wash-sale education expander (why an IRA buy blocks a brokerage harvest); and a sidebar nav indicator when clear harvest candidates exist.

## Why

Satisfies tax-intelligence AC 1 (statuses rendered per lot) and AC 5 (decision-support surface, no order paths).

## Acceptance Criteria

- [ ] Every engine candidate renders with lot detail, account chip, unrealized loss, status badge, and action column.
- [ ] Blocked rows show the human-readable reason and clear date inline.
- [ ] The education FAQ explains the cross-account rule and names the current threshold/rate settings.
- [ ] The sidebar Tax Center item shows an indicator dot iff ≥1 clear candidate exists.

## Depends On

- [cross-account-wash-guard](cross-account-wash-guard.md). ADR-010, ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/tax-center-view/`.
