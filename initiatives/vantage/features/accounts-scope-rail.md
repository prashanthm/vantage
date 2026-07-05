# Accounts & Scope Rail

> Part of epic: [account-aggregation](../epics/account-aggregation.md)
> **Slug:** accounts-scope-rail

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The linked-accounts model (id, name, type, taxable flag, sync status) and the persistent sidebar scope selector: each account plus an "All accounts" consolidated entry, with lot-derived balances, that sets the global account scope every other surface consumes.

## Why

Satisfies account-aggregation AC 1 ("switching scope re-derives totals…") — the scope rail is the control that makes every downstream view account-aware.

## Acceptance Criteria

- [ ] The rail lists all linked accounts with type, sync status, and a balance derived from the lots table at render time.
- [ ] An "All accounts" entry shows the consolidated total and is the default scope.
- [ ] Selecting any entry updates the shared scope state; no view retains stale scope.
- [ ] A read-only/no-orders note is visible in the rail (ADR-010 surface).

## Depends On

- None (foundation feature). ADR-005 (sidebar shell), ADR-007 (derived balances).

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/accounts-scope-rail/`.
