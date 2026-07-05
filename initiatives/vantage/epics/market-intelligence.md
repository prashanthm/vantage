# Market Intelligence

## Metadata

| Field | Value |
|-------|-------|
| **Slug** | market-intelligence |
| **Initiative** | [../initiative.md](../initiative.md) |
| **Product brief** | [../product-brief.md](../product-brief.md) |
| **Owner** | prashanthm |

> Joined to its GitHub issue by slug + branch; the issue links back here — no issue number stored in this file.

## Problem

Portfolio decisions happen against a market backdrop, but generic market news is noise. Traders want a fast, opinionated read — bias, momentum, levels, setups, sector rotation — in the same surface as their portfolio, so context and holdings inform each other.

## What We're Building

The Market Intel view: a per-symbol AI market read (bias badge, momentum/sentiment meters, level-aware summary), a daily AI picks list, a pattern-signals scanner with active/past tabs and outcome badges, and a GICS sector heatmap where any tile drills into an analysis modal that cross-references the user's holdings.

## Who It's For

Active traders and market-curious investors; every symbol surface links back to "do I own this, where?"

## Value

- One screen answers "what's the market doing and does it touch anything I own?"
- Signal history (hit target / stopped) keeps the scanner honest — no memory-holed calls.
- The heatmap gives instant sector-rotation context with portfolio cross-references.

## Acceptance Criteria

- [ ] Selecting any tracked symbol updates bias, meters, and summary without navigation.
- [ ] The signals table separates active from past, and past signals carry outcome badges.
- [ ] Every heatmap tile opens an analysis modal that states whether and where the user holds the name.
- [ ] All AI output sits under the educational-only banner (ADR-011); heatmap tints pass the CVD-validated diverging palette.

## Features

| Feature | Slug | Description | Phase |
|---------|------|-------------|-------|
| AI market summary | ai-market-summary | Per-symbol bias, momentum/sentiment meters, AI picks | Phase 2 — Intelligence |
| Pattern signals scanner | pattern-signals-scanner | Active/past signal table with outcomes | Phase 2 — Intelligence |
| Sector heatmap | sector-heatmap | GICS heatmap + holdings-aware drill-in modal | Phase 2 — Intelligence |

## Future Enhancements

- Real signal generation (live-data phase; prototype signals are curated mock).
- News intelligence tile (Fortune 6 parity) — after live data, needs a news feed.

## Additional Context

### Relevant ADRs

- [ADR-011](../adrs/011-compliance-banner.md) — all AI reads are educational-only.
- [ADR-006](../adrs/006-deterministic-mock-data.md) — mock reads/signals are deterministic fixtures.
