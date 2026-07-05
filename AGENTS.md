# Vantage — Agent Guide

Single-repo project: the code (static SPA prototype), the product layer
(`initiatives/vantage/`), and the engineering layer (`specs/<feature-slug>/`) all live
here. Kadence (ai-sdlc-toolkit) conventions apply: durable intent in markdown, status in
GitHub, one feature → one branch → one merge.

## Conventions

- Build with `./build.sh` (esbuild JSX transform); serve with `python3 -m http.server`.
- UI uses the Lookey design system: `window.LookeyDS.*` components + CSS tokens only.
- Vantage is decision-support only: no order placement, no fund movement, ever.
- ADRs live in `docs/adr/`; product docs in `initiatives/vantage/`; specs in `specs/`.

## Routing table

| Initiative | Purpose | INDEX.md |
|-----------|---------|----------|
| [`vantage`](initiatives/vantage/initiative.md) | The portfolio advances the mission goal of running each product as a tracked initiative while reusing one AI-SDLC toolkit and one UI design system across all products. | [`initiatives/vantage/INDEX.md`](initiatives/vantage/INDEX.md) |
