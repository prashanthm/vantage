# Chart Recommendation Panel

> Part of epic: [ai-charts](../epics/ai-charts.md)
> **Slug:** chart-recommendation-panel

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## What

The chart's context column: the AI read (bias, meters, summary), the user's position across accounts (per-lot detail plus an average-cost line drawn on the chart itself), and an AI recommendation card stating action, portfolio-aware rationale, and explicit risk.

## Why

Satisfies ai-charts AC 3 (position overlay when held) and AC 4 (action/rationale/risk, portfolio-aware) — where chart, portfolio, and tax calendar meet.

## Acceptance Criteria

- [ ] Held symbols show total shares/value/unrealized plus per-lot account rows, and the avg-cost line renders on the chart; unheld symbols state "Not held".
- [ ] The recommendation card always has action, rationale, and a risk line; for held names the rationale references the actual position (e.g. long-term date).
- [ ] An education expander explains what the markers are and restates the educational-only caveat.

## Depends On

- [chart-engine](chart-engine.md), [ai-chart-markers](ai-chart-markers.md). ADR-008 (tax-date awareness), ADR-011.

## Implementation

> Engineering detail is NOT in this doc. It lives in the code repo at `specs/chart-recommendation-panel/`.
