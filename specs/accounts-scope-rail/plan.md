# Accounts & Scope Rail — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/data.js (ACCOUNTS, LOTS)`
- `src/util.jsx (accountValue, selectedLots)`
- `src/app.jsx (sidebar rail, accountId state)`
- `app.css (.vg-acct)`

## Implementation Steps

1. Model accounts + lots in data module
2. Derive balances via pure functions
3. Render rail with selection state lifted to the shell
4. Pin rail in sidebar across all routes

## ADRs Applied

- ADR-005 (sidebar shell)
- ADR-007 (derived balances)
- ADR-010 (read-only note)

## Edge Cases

- Empty account (cash only) still renders a balance
- Scope state must survive route changes (lifted to shell)
