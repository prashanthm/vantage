# ADR-010: Read-only decision support — with one narrow, gated execution carve-out

## Status

Accepted — amended 2026-07-12 (v2). This ADR stays OPEN: the execution
carve-out below is deliberately narrow, and any widening (new strategy, new
broker, new order type outside the reclaim ticket) is done by amending this
ADR again — recording what widened and why — not by superseding it.

## Context

The portfolio-wide operating principle (mission + sentinel ADR-011/012 lineage) is a hard separation between analysis surfaces and anything that moves money. Vantage aggregates the household's whole financial picture — the blast radius of an execution bug or a hijacked surface would be maximal.

**Amendment context (v2, 2026-07-12):** the reclaim strategy graduated from
goal-validated backtest → paper track → staged order tickets (`order_ticket.py`),
at which point the only remaining manual step was retyping a fully-computed
ticket into Robinhood. Sentinel has been running the same Robinhood Agentic
Trading MCP write path (review/place/cancel equity order) in production with
dry-run defaults and env-gated live trading. The operator decided the
retype step now adds error risk (fat-fingering a computed ticket) without
adding safety, and asked to close the loop for THIS strategy only. Sentinel
is being retired; vantage inherits its OAuth grant (`.robinhood_token.json`)
as the grant's sole consumer, which is why the deploy mounts the token dir
read-write (refresh rotates the refresh token).

## Decision Drivers

1. Mission constraint: analysis/observation surfaces never mutate financial state by default; every execution path must be explicit, narrow, and independently gated.
2. Regulatory posture: a tool that recommends but never executes stays decision-support; the carve-out is limited to the operator's own account, operator-initiated, single-strategy.
3. Absence of code paths beats configuration — **preserved for everything except the carve-out**: the read connections (`brokers/robinhood.py`, `zerodha.py`, `schwab.py`, aggregator) keep their frozen read-only allowlists and refusal tests; no write tool is reachable through them.
4. Rejected: **"paper trading" execution simulation** — normalizes an execution surface that policy forbids. Rejected: **broker deep-links pre-filling orders** — superseded by the carve-out (a gated real submission is more auditable than a gray-zone deep-link).
5. Rejected (v2): **a general `place_order` API** — the execution surface accepts only a server-recomputed reclaim ticket, never client-supplied prices/quantities, so the strategy constraint is structural, not conventional.

## Research & Rubric

v1: no options weighed — inherited/charter decision (portfolio-wide separation principle).
v2: pattern lifted from sentinel's proven adapter (`sentinel/brokers/robinhood.py`): deterministic MCP tool calls (no LLM in the order path), dry-run default, env-gated live mode, review-before-place.

## Decision

Vantage remains read-only decision support, with exactly ONE execution
carve-out:

**The reclaim-ticket execute path** — `brokers/robinhood_execution.py`,
reached only via `POST /api/ticket/execute` — may submit equity orders to
Robinhood's Agentic Trading MCP server, under ALL of these constraints:

1. **Reclaim strategy only.** The server recomputes the ticket from
   `reclaim_strategy` geometry (entry/stop/target ladder/risk sizing) at
   execute time. Client-supplied prices, quantities, or order lists are never
   accepted; there is no general order endpoint.
2. **Robinhood only.** No other broker connection gains a write path; their
   transport-layer read-only allowlists and refusal tests stay mandatory.
3. **Separate write dispatcher with its own frozen allowlist** —
   `review_equity_order`, `place_equity_order`, `cancel_equity_order` and
   nothing else. The read dispatcher (`robinhood.py:_call`) keeps refusing
   every write tool; the write dispatcher refuses every tool outside its own
   three. Both refuse before any network I/O.
4. **Dry-run by default, double-gated live mode.** Live submission requires
   the caller to set `live=true` AND the operator to have set
   `VANTAGE_LIVE_OK=1` in the environment. Either missing → dry-run.
5. **Operator-initiated only.** No scheduler, nightly job, refresh path, or
   MCP tool (the AI advisor surface) may reach the execute path. It is not
   exposed as a vantage-mcp tool.

Everything else in the v1 decision stands: no other code that places orders,
transfers funds, or writes to any broker or financial account; aggregation is
read-only; every roadmap item that would widen the carve-out requires
amending this ADR first.

## Consequences

### Becomes Easier

- Trust boundary remains auditable by inspection: read connections still contain no write path; the ONE write module is small, allowlisted, and has refusal tests on both sides.
- The validated reclaim workflow closes the loop: staged ticket → review → submit, with no error-prone manual retype.
- Sentinel's battle-tested submission pattern (review-before-place, retries, dry-run stubs) is reused rather than reinvented.

### Becomes Harder

- The compliance surface changes: Vantage is no longer categorically "never executes" (ADR-011's banner and docs must say "executes only operator-initiated reclaim tickets to Robinhood").
- The ADR-010 audit is now two checks instead of one: (a) read connections have no write path, (b) the write module's allowlist and gates are intact.

## Applies To

- Every feature and spec in the initiative; ADR-008 (TLH is advisory), ADR-011 (banner — needs a wording update per v2).
- `brokers/base.py` doctrine docstring, `brokers/robinhood_execution.py`, `POST /api/ticket/execute`, `tests/test_robinhood_execution.py`, the `ALLOWED_WRITE_ROUTES` guard in `tests/test_api.py`.

## Amendment Log

- **v1 (accepted):** absolute read-only — no order or fund-movement code paths.
- **v2 (2026-07-12):** reclaim-ticket → Robinhood execution carve-out, per the constraints above. Future widenings append here.
