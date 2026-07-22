# facebook/astryx — evaluation for Vantage (2026-07-22)

Astryx (beta v0.1.7, MIT, 10.3k★): Facebook's open design system — 150+
accessible React components, StyleX-built with prebuilt-CSS consumption, seven
themes (neutral/butter/chocolate/matcha/stone/gothic/y2k + meta/whatsapp), a
CLI (docs, scaffolding, codemods), positioned for human+AI-agent collaboration.
Charts (@astryxdesign/charts, vega) are canary-only.

## Fit assessment

- **Core stack: POOR.** Vantage is deliberately no-bundler (build.sh, React
  globals, hand-rolled vg-* CSS). Astryx is npm+TS+StyleX — adopting it means
  introducing a package build, a foundational change, not a library add.
- **Design identity: CONFLICTS.** Vantage's system is established and
  deliberate (IBM Plex, 12px floor, chip grammar, AGENTS.md component gate,
  the plain-narrative register). Reskinning forfeits it for a beta's churn.
- **Where it IS useful, ranked:**
  1. **Agent-collaboration conventions** — Astryx documents typed component
     contracts so agents generate against them reliably. Worth cribbing for
     our AGENTS.md gate: document vg-* components (props, states, when-to-use)
     the way Astryx's CLI does. Zero dependency, real payoff.
  2. **Accessibility reference** — 150 MIT components to check our chips/
     tables/details/dialogs against (focus states, aria, keyboard paths).
  3. **Greenfield surfaces** — anything standalone outside the SPA (public
     research-notes site, docs) could adopt it wholesale.
  4. **Charts: no** — canary, and lightweight-charts is proven here.

## Recommendation

DON'T adopt in Vantage core; monitor. Beta (v0.1.x API churn) + stack
mismatch + identity conflict outweigh the benefits today. Concrete take-away
adopted as backlog: an "AGENTS.md component contract" pass documenting vg-*
components Astryx-style. Revisit at v1.0 or the first greenfield surface.
Visual comparison artifact: cockpit checklist + Levels watch rendered in both
idioms (Astryx side approximated — exact tokens require the npm package).
