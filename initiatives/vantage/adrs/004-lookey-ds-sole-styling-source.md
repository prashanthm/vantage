# ADR-004: Lookey design system is the sole styling source

## Status

Accepted

## Context

The initiative mandate (mission: one design system across products) requires the UI to be built from the Lookey DS (`pm-design-system` on claude.ai/design). Lookey is a prop-styled marketing kit: components carry their own `lk-*` classes and the system exposes 13 CSS custom-property tokens; it explicitly forbids inventing utility classes on its components.

## Decision Drivers

1. Mission-level reuse goal: every product starts from the same known-good design baseline.
2. Lookey's contract is props + tokens, not utility classes — app styling must compose around components, never restyle their internals.
3. A dashboard needs surfaces the marketing kit lacks (tables, heatmaps, charts, slide-overs); these must still read as the same brand.
4. Rejected: **restyling `lk-*` internals** — breaks on every DS update and violates the DS contract. Rejected: **a second CSS framework (Tailwind etc.) for app surfaces** — two styling systems on one page guarantees brand drift.

## Research & Rubric

No options weighed — inherited constraint from the pm-design-system contract and mission.

## Decision

All UI is built from `window.LookeyDS.*` components where one fits, and otherwise from app-owned `vg-*` glue classes that consume **only DS tokens** (`--color-*`, `--font-family-base`). The single sanctioned extension is a danger/success-deep status pair (`--vg-danger`, `--vg-success-deep`) that Lookey doesn't ship, validated for contrast/CVD alongside the DS palette.

## Consequences

### Becomes Easier

- DS updates flow in by re-copying the bundle; brand consistency is structural.
- Any Lookey-based product can absorb Vantage surfaces (and vice versa).

### Becomes Harder

- Dashboard-grade components (data tables, charts) must be hand-built as token-styled glue rather than pulled from a component market.

## Applies To

- Every UI feature; ADR-003 (loading contract), ADR-005 (view shell), all chart/table specs.
