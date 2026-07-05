# Income Ideas Screener — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/options.jsx (ideas table + cards)`
- `src/data.js (INCOME_IDEAS)`

## Implementation Steps

1. Screen holdings/cash fixtures into ideas
2. Render table with eligibility + caveats
3. Add TLH/approval SecurityCards + FAQ

## ADRs Applied

- ADR-008 (wash cross-check)
- ADR-010 (never staged as orders)

## Edge Cases

- Sub-100-share positions surface as teaching rows, not hidden
