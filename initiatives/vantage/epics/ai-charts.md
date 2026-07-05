# AI Charts

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | ai-charts |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Charts everywhere else are context-free: they don't know what the viewer paid, what the AI already flagged, or what the tax calendar says. The user wants one full screen where price action, AI annotations, their own position, and a concrete recommendation coexist.

## What We're Building

The AI Charts view: a full-width candlestick chart (volume subchart, support/resistance levels, crosshair OHLC tooltip, timeframes) annotated with AI markers (accumulation/distribution/notes — including TLH-window events on owned lots), the user's average-cost line drawn on the chart, and a side panel with the AI read, the position across accounts, and a portfolio-aware recommendation with explicit risk.

## Who It's For

Traders who live on charts; investors who want the chart to explain itself.

## Value

- The chart carries the user's reality: cost basis, lots, tax dates — not just price.
- AI markers with a visible history (dated timeline chips) build calibrated trust.
- Recommendations fuse technicals with portfolio facts (e.g. trim after the long-term date).

## Acceptance Criteria

- [ ] Chart renders candles + volume for every tracked symbol across 1M/3M/6M with a crosshair tooltip (date + OHLC + marker text).
- [ ] AI markers render as typed glyphs with a legend and a dated marker timeline; markers are never color-only.
- [ ] When the symbol is held in any account, the average-cost line and per-lot panel render; otherwise "Not held".
- [ ] The recommendation panel states action, rationale, and risk — portfolio-aware where held.
- [ ] Series are deterministic per symbol (ADR-006) and end exactly at the quoted price.

## Features

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| Chart engine | chart-engine | SVG candles, volume, levels, crosshair, timeframes | Phase 2 — Intelligence |
| AI chart markers | ai-chart-markers | Typed marker glyphs, legend, dated timeline | Phase 2 — Intelligence |
| Chart recommendation panel | chart-recommendation-panel | AI read + position overlay + action/risk panel | Phase 2 — Intelligence |

## Future Enhancements

- Real OHLC history and intraday timeframes (live-data phase, ADR-013).
- Drawing tools / user annotations — after real data; not before.

## Additional Context

### Relevant ADRs

- [ADR-006](../adrs/006-deterministic-mock-data.md) — seeded series; markers anchor to stable bars.
- [ADR-004](../adrs/004-lookey-ds-sole-styling-source.md) — chart colors come from the validated token-adjacent palette.
