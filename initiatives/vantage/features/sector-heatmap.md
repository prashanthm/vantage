# Sector Heatmap

> Part of epic: [market-intelligence](../epics/market-intelligence.md)
> **Slug:** sector-heatmap

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The GICS sector heatmap: 11 sector cards with aggregate 1-day change and per-stock tiles tinted on the validated red↔green diverging scale with signed percentage text; any tile opens an analysis modal combining the day move, the AI read where available, and whether/where the user holds the name.

## Why

Satisfies market-intelligence AC 3 (holdings-aware drill-in) and AC 4 (CVD-validated tints, never color-alone).

## Acceptance Criteria

- [ ] All 11 sectors render with aggregate change and per-stock tiles; tint intensity scales with |move| and text always carries the signed value.
- [ ] Clicking a tile opens the analysis modal; held names state the holding accounts, others state "Not held".
- [ ] Near-flat moves render neutral (not red/green), keeping polarity honest.

## Depends On

- [ai-market-summary](ai-market-summary.md) (modal reuses the AI read). ADR-004 (palette discipline).

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/sector-heatmap/`.
