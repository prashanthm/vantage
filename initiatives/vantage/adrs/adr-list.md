# ADR Catalog — Vantage

Decision inventory for the Vantage initiative. The prototype exists, so most Phase 1/2
decisions are made-and-implemented; they are cataloged here and ratified as individual
ADRs via adr-maintenance. Deferred rows are decisions the live-data phase must make.

## Inherited constraints

| Source initiative | ADR | Constraint |
|-------------------|-----|------------|
| sentinel | Sentinel / ADR-007 | TLH is decision-support only: the tool marks lots and reports; harvesting is a human clicking buttons at their broker — Vantage keeps the same boundary. |
| sentinel | Sentinel / ADR-008 | TLH semantics (lots file shape, harvest thresholds, 30-day wash window, different-index partner map, auto-buys) are the reference model Vantage's Tax Center must conform to. |

## Proposed ADRs — Vantage

### Core

| ID | Title | Status | Summary |
|----|-------|--------|---------|
| ADR-001 | Single private repo for code, product docs, and specs | Proposed | Code, `initiatives/vantage/`, and `specs/` live in one private GitHub repo (prashanthm/vantage) — no product-workspace split for a solo prototype. |
| ADR-002 | Trunk-based yolo delivery: short-lived branches, self-merge | Proposed | Prototype-phase work merges to `main` by the author without PR review; the branch/merge discipline is kept so a review gate can be added later without re-tooling. |
| ADR-003 | Buildless static SPA: React globals + one-shot esbuild JSX transform | Proposed | No framework, bundler config, or node project; React and the DS load as page globals and `build.sh` only transforms JSX. |
| ADR-004 | Lookey design system is the sole styling source | Proposed | UI is `window.LookeyDS.*` components plus DS tokens; app-owned `vg-*` glue may consume tokens but never restyles `lk-*` internals or introduces brand colors. |
| ADR-005 | Hash-routed sidebar views, one job per screen | Proposed | Navigation is a persistent sidebar over `#/`-routed views (Portfolio / Intelligence groups) with global account scope pinned in the sidebar. |

### Data

| ID | Title | Status | Summary |
|----|-------|--------|---------|
| ADR-006 | Deterministic mock data layer with frozen clock | Proposed | All market/portfolio data is a committed mock module with a frozen `TODAY` and a seeded OHLC generator so every render and wash-sale computation is reproducible. |
| ADR-007 | Portfolio math is pure functions over a single lots table | Proposed | `LOTS` is the only source of position truth; consolidation, overlap, drift, and TLH candidates are derived per render — never stored, so nothing drifts. |
| ADR-008 | Cross-account wash-sale model (all accounts + auto-buys) | Proposed | Wash windows are evaluated over every linked account including IRAs (Rev. Rul. 2008-5) and scheduled auto-buys, using substantially-identical families and the sentinel partner map. |
| ADR-009 | Client-side persistence only (localStorage), no auth in prototype | Proposed | User preferences persist in namespaced localStorage; there is no backend, no accounts system, and no PII stored — auth is deferred to the live-data phase. |

### Security & Compliance

| ID | Title | Status | Summary |
|----|-------|--------|---------|
| ADR-010 | Read-only decision support: no order or fund-movement code paths | Proposed | Vantage never places orders, holds funds, or writes to brokers; the codebase must contain no execution integration, mirroring the portfolio-wide analysis/execution separation. |
| ADR-011 | Educational-only compliance banner on every AI surface | Proposed | Every view that renders AI-generated analysis carries the persistent "educational purposes only — not financial, investment, or tax advice" banner. |

### Deployment

| ID | Title | Status | Summary |
|----|-------|--------|---------|
| ADR-012 | Static hosting; no server components before the live-data phase | Proposed | The prototype deploys as static files (local `http.server` or any static host); introducing any server is a live-data-phase decision. |
| ADR-013 | Live data backend & broker aggregation (Phase 3) | Proposed | (Phase 3 — deferred) Choose the quote feed and read-only broker-aggregation approach (e.g. yfinance-class feed vs aggregator API) and where lots import lives. |
