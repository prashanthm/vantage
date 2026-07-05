# ADR-011: Educational-only compliance banner on every AI surface

## Status

Accepted

## Context

Vantage renders AI-generated market bias, recommendations, tax analysis, and options ideas. Retail market-intelligence products in this category (reference: Fortune 6, which repeats the disclaimer on every tile) uniformly carry a persistent not-financial-advice disclaimer; the builder is not a licensed advisor.

## Decision Drivers

1. Every view contains AI output, so a per-tile disclaimer would repeat dozens of times; one persistent global banner above the shell covers all routes deterministically.
2. Tax analysis raises the bar: the wording must disclaim financial, investment, **and tax** advice.
3. Demo honesty: the same banner discloses simulated data, so no screenshot can circulate implying live performance.
4. Rejected: **per-view/per-tile disclaimers only** — easy to miss on new views; the global banner is structural. Rejected: **one-time dismissible modal** — dismissal defeats the purpose on shared screens.

## Research & Rubric

No options weighed — inherited industry-standard practice for the category.

## Decision

A persistent, non-dismissible banner renders above the app shell on every route: "AI-generated analysis · Demo with simulated data · Educational purposes only — not financial, investment, or tax advice." Sections add sharper local caveats where stakes are higher (Tax Center, Options, Charts), but the global banner is the guarantee.

## Consequences

### Becomes Easier

- New views are compliant by construction; no per-feature disclaimer checklist.

### Becomes Harder

- Permanent vertical cost (~30px) on every screen; wording changes are a single point requiring care.

## Applies To

- The SPA shell spec and every AI-rendering feature; ADR-010.
