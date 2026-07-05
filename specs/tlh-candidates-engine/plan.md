# TLH Candidates Engine — Plan

> Spec: [`spec.md`](./spec.md) · Tasks: [`tasks.md`](./tasks.md)

## Files

- `src/util.jsx (tlhCandidates, lot helpers)`
- `src/data.js (LOTS, PARTNER_MAP, MARKET)`

## Implementation Steps

1. Mark lots to latest close
2. Filter losers; apply thresholds; branch on account taxability
3. Attach wash status + replacement per candidate

## ADRs Applied

- ADR-008 (model)
- ADR-006 (frozen clock)
- Inherited: Sentinel ADR-007/008

## Edge Cases

- Tax-advantaged lots are excluded as candidates but still listed (N/A) for transparency
- Loss can pass either the $ or the % threshold
