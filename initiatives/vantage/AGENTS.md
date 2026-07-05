# AGENTS.md

Guidance for AI agents (and humans) working in the `vantage` initiative. The portfolio advances the mission goal of running each product as a tracked initiative while reusing one AI-SDLC toolkit and one UI design system across all products.

Read the repo-root [`AGENTS.md`](../../AGENTS.md) first — it documents repository-wide conventions, the initiative routing table, and the duplication-check discipline that applies before drafting any new epic, feature, or spec content in this initiative.

## What this initiative delivers

Vantage is a **one-stop decision-support hub for traders and investors**: it aggregates every linked brokerage account read-only, computes consolidated holdings, tax-loss-harvesting opportunities with cross-account wash-sale windows, overlap and concentration flags, and allocation drift — and layers on market intelligence (AI market read, pattern signals, sector heatmap), options intelligence (income ideas screened against actual holdings per account), and full-screen AI-annotated charts with portfolio-aware recommendations.

Vantage **never holds funds and never places orders** — it preserves the portfolio-wide hard separation between analysis surfaces and anything that moves money. Recommendations, analysis, and notifications only; execution stays a human clicking buttons at their broker.

## Where things live

```
vantage/
├── initiative.md      # Charter: Status, Why, What
├── product-brief.md   # Capability brief + Epic Index (release order)
├── epics/<epic-slug>.md
├── features/<feature-slug>.md
├── adrs/               # Architecture Decision Records (where applicable)
└── INDEX.md            # Generated — do not hand-edit
```

Before drafting new epic, feature, or spec content under this initiative, read [`INDEX.md`](INDEX.md) (once generated — see the repo-root `AGENTS.md` if it does not exist yet) to check whether the capability already exists under a sibling epic.
