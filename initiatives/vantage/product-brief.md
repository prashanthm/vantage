# Vantage — Cross-Account Portfolio Intelligence

> One vantage point over every brokerage account: consolidated holdings, tax-aware recommendations, and AI market/options/chart intelligence — read-only, always.

## Initiative

> Part of: [vantage](initiative.md)
> See: `initiatives/vantage/initiative.md`

## What This Capability Delivers

Vantage aggregates multiple brokerage accounts (taxable, IRA, 401(k), robo) into one decision-support surface: consolidated positions and allocation, tax-loss-harvesting candidates with wash-sale windows computed across *all* accounts, overlap/concentration/drift flags, and a ranked recommendations feed — plus an intelligence layer of AI market reads, pattern signals, options income ideas screened against the user's actual book, and full-screen AI-annotated charts. It replaces per-broker tab-hopping and single-account tax tools that miss cross-account wash sales.

## Who It's For

- **Self-directed investors** with 2+ brokerage accounts who harvest losses and rebalance themselves.
- **Active traders** who want portfolio-aware market/options intelligence rather than generic scanners.
- (Prototype phase: the builder's own household accounts; simulated data.)

## Components

| Component | Role |
|-----------|------|
| SPA shell (Lookey DS) | Sidebar-routed views, account scoping, notifications, chat, settings |
| Portfolio engine | Pure-JS consolidation, overlap, drift, and TLH/wash-sale math (`src/util.jsx`) |
| Mock data layer | Deterministic dataset + seeded OHLC generator (`src/data.js`, `src/ohlc.js`) |
| Intelligence surfaces | Market Intel, Options Intel, AI Charts views |
| Lookey design system | `pm-design-system` components + tokens; the only styling source |
| (Planned) data backend | Real quotes + read-only broker aggregation for the live-data phase |

## Epic Index

| Epic | Slug | Outcome | Description | Phase | Epic doc |
|------|------|---------|-------------|-------|----------|
| Account Aggregation | account-aggregation | All linked accounts render as one consolidated, scope-switchable portfolio | Accounts model, scoping, consolidation math, holdings views | Phase 1 — Core | epics/account-aggregation.md |
| Tax Intelligence | tax-intelligence | Every harvestable loss is found and wash-checked across all accounts | TLH engine, partner map, wash windows incl. auto-buys, Tax Center view | Phase 1 — Core | epics/tax-intelligence.md |
| Portfolio Insights | portfolio-insights | Cross-account risks surface as ranked, explainable recommendations and alerts | Overlap/drift/concentration/cash-drag recs, notifications center, AI chat | Phase 1 — Core | epics/portfolio-insights.md |
| Market Intelligence | market-intelligence | A daily AI market read grounds every symbol the user touches | AI summary/bias, picks, pattern signals, sector heatmap | Phase 2 — Intelligence | epics/market-intelligence.md |
| Options Intelligence | options-intelligence | Options income ideas are generated from the user's actual holdings per account | IV context, covered-call/CSP screener, unusual flow, TLH cross-checks | Phase 2 — Intelligence | epics/options-intelligence.md |
| AI Charts | ai-charts | A full-screen chart explains itself: markers, levels, cost basis, recommendation | Candles + volume, AI markers, S/R levels, position overlay, rec panel | Phase 2 — Intelligence | epics/ai-charts.md |
| Live Data Platform | live-data-platform | The same views run on real quotes and real (read-only) account data | Quote feed, broker aggregation, lots import, refresh jobs | Phase 3 — Live data | — |
