# AI Market Summary

> Part of epic: [market-intelligence](../epics/market-intelligence.md)
> **Slug:** ai-market-summary

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The per-symbol AI market read: symbol pills for the tracked set, a bias badge (Bullish/Neutral/Bearish), momentum and sentiment meters, a level-aware summary paragraph, and the daily AI picks list with stance, confidence, and click-through to the read.

## Why

Satisfies market-intelligence AC 1 (symbol switch updates read without navigation) and grounds AC 4 (educational-only surface).

## Acceptance Criteria

- [ ] Selecting any tracked symbol swaps bias, meters, and summary in place.
- [ ] Bias badges use the three-state styling; meters show 0–100 with visible values.
- [ ] AI picks rows click through to the corresponding symbol read where one exists.
- [ ] The view renders under the global compliance banner with a per-view educational note.

## Depends On

- None (fixture-driven). ADR-006, ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/ai-market-summary/`.
