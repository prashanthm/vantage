# Vantage — Cross-Account Portfolio & Market Intelligence

> **Slug:** vantage

## Why

The portfolio advances the mission goal of running each product as a tracked initiative while **reusing one AI-SDLC toolkit and one UI design system across all products**. Sentinel proved the analysis discipline (TLH monitor, decision logging, read-only dashboards) but its intelligence is locked to a single account and a single product surface. Every real investor in the household operates **multiple brokerage accounts** (taxable, Roth IRA, 401(k), robo), and the highest-value insights — wash-sale conflicts, duplicated exposure, allocation drift, idle cash — are *cross-account properties that no single-account tool can see*. Why now: the Lookey design system and the sentinel TLH engine both exist and are proven; Vantage composes them into a new product while the prototype momentum is fresh.

## What

Vantage is a **one-stop decision-support hub for traders and investors**: it aggregates every linked brokerage account read-only, computes consolidated holdings, tax-loss-harvesting opportunities with cross-account wash-sale windows, overlap and concentration flags, and allocation drift — and layers on market intelligence (AI market read, pattern signals, sector heatmap), options intelligence (income ideas screened against actual holdings per account), and full-screen AI-annotated charts with portfolio-aware recommendations.

Vantage **never holds funds and never places orders** — it preserves the portfolio-wide hard separation between analysis surfaces and anything that moves money. Recommendations, analysis, and notifications only; execution stays a human clicking buttons at their broker.

## Success Criteria

- [ ] A user can link ≥ 2 accounts and see one consolidated view whose totals re-derive per account scope with zero manual entry.
- [ ] Every TLH candidate is wash-sale-checked across **all** linked accounts (including IRAs and scheduled auto-buys); no recommendation ever contradicts the Tax Center.
- [ ] Each of the seven views (Overview, Holdings, Tax Center, Recommendations, Market Intel, Options Intel, AI Charts) is reachable in ≤ 2 clicks and deep-linkable.
- [ ] 100% of UI surfaces are built from the Lookey design system (components or tokens) — no ad-hoc brand styling.
- [ ] Every screen that shows AI output carries the educational-only compliance banner; the product contains zero order-placement code paths.

## Depends On

| Initiative | Why |
|-----------|-----|
| Sentinel | TLH engine semantics (`tlh_monitor.py`: lots, partner map, wash windows, auto-buys) are the reference model for the Tax Center |
| None (design system) | Lookey DS (`pm-design-system`) is consumed as a published artifact, not co-developed |

## Deployment Variants

| Variant | Included | Notes |
|---------|----------|-------|
| Prototype (mock data) | Yes | Static SPA, seeded mock dataset, no backend — the current build |
| Live read-only | Phase: live-data | Real quotes + broker aggregation (read-only); requires a data backend |
| Multi-user SaaS | No | Out of scope for this initiative |

> Phasing, targets, and progress are tracked on the GitHub Projects Roadmap / milestones; not in this file. Release order by phase name lives in product-brief.md's Epic Index.
