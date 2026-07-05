# ADR-012: Static hosting — no server components before the live-data phase

## Status

Accepted

## Context

With mock data (ADR-006), pure client math (ADR-007), and localStorage persistence (ADR-009), nothing in the prototype requires a server. Every server added to household-finance tooling is attack surface and ops burden.

## Decision Drivers

1. The deploy artifact is four static things: `index.html`, `app.css`, `app.js`, vendored `ds/` + `vendor/` — any static host or `python3 -m http.server` serves it.
2. No server means no secrets, no TLS management, no uptime obligation during the prototype phase.
3. Hash routing (ADR-005) was chosen specifically so no rewrite rules are needed.
4. Rejected: **small node/python API now** — nothing to serve; would exist only as speculative scaffolding (YAGNI). Rejected: **hosted SaaS deployment** — the initiative explicitly excludes multi-user SaaS.

## Research & Rubric

No options weighed — consequence of ADR-003/006/007/009; the live-data revisit is ADR-013.

## Decision

The prototype ships as static files only. Introduction of any server component is the live-data phase's decision (ADR-013) and must not happen incrementally before it.

## Consequences

### Becomes Easier

- Deployment is copy-files; local demo is one command; zero standing infrastructure.

### Becomes Harder

- No server-side quote proxy — the live-data phase must solve CORS/keys/refresh as a package (ADR-013), not piecemeal.

## Applies To

- Deployment/runbook docs; ADR-003, ADR-009, ADR-013.
