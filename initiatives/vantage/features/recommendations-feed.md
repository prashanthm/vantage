# Recommendations Feed

> Part of epic: [portfolio-insights](../epics/portfolio-insights.md)
> **Slug:** recommendations-feed

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The ranked recommendations surface: accent-coded cards for the six cross-account insight types (harvest, pause-auto-buy, concentration, overlap consolidation, rebalance-by-contribution, cash drag), each with the accounts involved, a rationale, and estimated annual impact where quantifiable; the top two also surface on the Overview.

## Why

Satisfies portfolio-insights AC 1 (ranked, explained cards) and AC 2 (never contradicts the Tax Center).

## Acceptance Criteria

- [ ] All six insight types render as cards with a distinct status accent and a plain-language rationale.
- [ ] TLH-related cards derive their figures from the same engine as the Tax Center (no duplicated wash logic).
- [ ] Quantifiable cards state an estimated annual impact that re-derives from settings (e.g. tax rate).
- [ ] The Overview shows the top actions with a link into the full feed.

## Depends On

- [cross-account-wash-guard](cross-account-wash-guard.md), [consolidated-holdings](consolidated-holdings.md). ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/recommendations-feed/`.
