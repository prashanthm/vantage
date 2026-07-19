# ADR-015: Autonomous strategy lifecycle execution (Alpaca) — paper → gated promotion → bounded autonomous live

## Status

Proposed — 2026-07-19. Amends ADR-010 (append v4): this is the "new broker +
new strategy surface + autonomous entry" widening that ADR-010 requires be
sanctioned by amendment, not by a silent code path. ADR-010 stays the parent
doctrine; this ADR carries the autonomous-lifecycle carve-out.

## Context

ADR-010 established read-only decision support with one narrow execution
carve-out: the reclaim-ticket path to Robinhood, **operator-initiated for
anything that opens exposure** (§5), with exits-only automation (v3). The
operator now wants a **strategy lifecycle platform**: a named strategy is
validated on a broker paper account, and only after it beats its own frozen
backtest baseline may it be **promoted** — manually — to a live cash/margin
account where it trades **autonomously** (opens and closes exposure without a
human pressing execute per trade), including multi-leg options.

This crosses two lines ADR-010 held: (1) a **second broker** (Alpaca, chosen
for true paper/live parity and Level-3 multi-leg options — the parity is what
makes a paper win-rate predictive of live), and (2) **autonomous opening of
exposure**, which v2/v3 explicitly forbade. Autonomous entry removes the human
circuit-breaker that made the Robinhood carve-out safe without caps. Therefore
the safety that was implicit (a human) must become explicit and enforced in
code: caps, a kill switch, and an immutable audit log.

The existing machinery is reused, not rebuilt: `reclaim_strategy` geometry +
`is_worth_taking` edge guard, `paper.py` win-rate, the frozen `backtest.py`
baseline, the `brokers/base.py` registry pattern, and the
`robinhood_execution.py` gating pattern (double env gate, frozen allowlist,
`ExecutionViolation`-before-I/O, structural reduce-only). Robinhood's carve-out
is untouched.

## Decision Drivers

1. **ADR-010 is a tested gate, not prose** — enforced by `test_api.py`'s
   `ALLOWED_WRITE_ROUTES` and the `brokers/base.py` read-only doctrine. The
   autonomous path cannot exist until this ADR sanctions it; a code path that
   opened exposure autonomously without this amendment would violate a
   currently-passing test.
2. **Paper must predict live** — the promotion gate is only meaningful if the
   paper fill engine matches live. Alpaca's native paper endpoint (same API,
   `paper-api.alpaca.markets`) gives that parity; a paper sim on one broker
   promoting to another (Robinhood) would not.
3. **Autonomous entry removes the human circuit-breaker** — every safety the
   Robinhood path got for free from "a human presses execute" must be
   re-supplied structurally: bounded size, a stop, a way to halt everything,
   and a record of every decision.
4. **Promotion is a deliberate act, never automatic** — passing the gate only
   *enables* promotion; a strategy never self-promotes from paper to live.
5. **Reversibility** — paper is fully reversible (no money); the gate is
   reversible (re-measure); autonomous live is the only irreversible step and
   is therefore last, smallest, and most-gated. Build order follows
   reversibility.
6. **Single source of truth preserved** — strategy geometry stays in
   `reclaim_strategy`; the server recomputes every order from strategy geometry
   at submit time (client never supplies prices/quantities), exactly as the
   reclaim ticket does today.

## Research & Rubric

Option-weighing decision — see [the research/rubric doc](../research/adr-015-autonomous-lifecycle.md)
for the scored comparison of execution-autonomy levels (human-in-loop /
exits-only / paper-only / bounded-autonomous) and broker choice (Alpaca /
Robinhood / IBKR) against parity, options support, safety surface, and reuse.

## Decision

Vantage gains a **strategy lifecycle** with a second, separately-gated execution
carve-out for **Alpaca**, under ALL of these constraints. Robinhood's ADR-010
carve-out is unchanged and independent.

### The lifecycle (one strategy moves through explicit stages)

`paper → eligible → live → paused`. A strategy is a registered impl
(`reclaim` is the first) behind a `@register_strategy` registry mirroring
`brokers/base.py`. Its stage is persisted per strategy.

1. **paper** — the strategy runs against Alpaca's paper endpoint. Real
   fills-parity, no money. Win-rate accrues via the existing `paper.py` /
   `signal_bot.performance` analysis over its closed trades.
2. **eligible** — reached only when the strategy's **paper win-rate beats its
   frozen backtest baseline** (`backtest.score()['overall']['win_rate']` on the
   frozen `server/backtest_data/` cache with the strategy's champion params)
   over a minimum sample. This is a measurement, not an action.
3. **Promote (manual, explicit)** — the operator, and only the operator,
   promotes an *eligible* strategy to `live`, choosing the account (cash/margin)
   and setting the strategy's caps. Passing the gate only ENABLES the button;
   nothing auto-promotes. A non-eligible strategy cannot be promoted.
4. **live (bounded autonomous)** — the strategy may open AND close real Alpaca
   orders without per-trade operator initiation, only within the four gates
   below.
5. **paused** — any cap breach, the kill switch, or operator action moves a
   live strategy to `paused`: it stops opening exposure; resting protective
   stops remain at the broker.

### The Alpaca order path — `brokers/alpaca_execution.py`

A separate write module (NOT a registered `brokers/` connection; the read
side is a separate read-only `alpaca_broker.py` following `base.py`). It
mirrors `robinhood_execution.py` and **exceeds** it:

- **Server-recomputed orders only** — every order (multi-leg included) is
  computed from `reclaim_strategy` geometry at submit time; client-supplied
  prices/quantities/legs are never accepted. No general `place_order` endpoint.
- **Frozen allowlist + refuse-before-I/O** — its own frozen tool/endpoint set;
  anything outside it raises `ExecutionViolation` before any network call, with
  a refusal unit test (per `base.py` doctrine).
- **Structural reduce-only exits** — the exit path derives side/quantity from
  the open position; it can never increase exposure or exceed the managed
  quantity, exactly like the reclaim exit monitor.
- **Edge guard** — every entry re-runs `is_worth_taking`; negative-edge trades
  are refused.

### The FOUR hard gates on autonomous live (all mandatory, all enforced)

1. **Global kill switch + `VANTAGE_LIVE_OK`.** No Alpaca live order without
   `VANTAGE_LIVE_OK=1` AND a dedicated autonomous gate (`VANTAGE_AUTONOMOUS_OK=1`
   — distinct from the reclaim path's live gate, so enabling one never enables
   the other). A kill switch (a UI control + a filesystem flag the order path
   reads before every submit) instantly halts every strategy and cancels open
   orders. Either gate missing, or the kill switch set → no order; strategies
   move to `paused`.
2. **Per-strategy caps.** Each promoted strategy carries hard limits: max $ per
   order, max concurrent positions, and a daily max-loss. The caps are checked
   in the order path *before* submit; a breach auto-pauses that strategy (and
   only that strategy) and cancels nothing already protected by a resting stop.
3. **Manual, explicit promotion.** (As above.) Codified here so it is a gate,
   not a convention: the live stage is unreachable except through an operator
   promote action on an eligible strategy.
4. **Immutable audit log.** Every autonomous order decision — intent, the
   recomputed order, the reason, the strategy, size, gate state, and the fill
   or rejection — is written to an append-only audit table before/after submit
   and surfaced in the UI. `log.info` alone (the Robinhood path's current level)
   is insufficient once a human is not in the loop.

### Boundaries preserved

- Robinhood's ADR-010 carve-out is untouched and independent (its own gate, its
  own allowlist). Enabling Alpaca autonomous never enables Robinhood or vice
  versa.
- Every OTHER broker connection (`zerodha`, `schwab`, aggregator) stays
  read-only with its refusal tests.
- The AI/Mira surface never reaches the order path (no vantage-mcp order tool);
  strategies are deterministic code, no LLM in the order path.
- A new order route is added to `test_api.py`'s `ALLOWED_WRITE_ROUTES`
  (POST-only) with a refusal test; the read side stays GET-only.

## Consequences

### Becomes Easier

- A validated strategy closes the loop end-to-end (paper → gated promotion →
  autonomous live) without per-trade manual entry, on a broker whose paper
  fills predict live.
- The lifecycle is auditable by inspection: read connections have no write
  path; the ONE new write module is small, allowlisted, refusal-tested; every
  live action is in the audit log; the four gates are individually testable.
- Multi-leg options strategies become expressible (Alpaca Level 3), which the
  Robinhood agentic path could not do.

### Becomes Harder

- **The blast radius grows materially.** Autonomous entry means code — not a
  human — can open real positions. This is the single largest risk in the
  system; it is the reason caps + kill switch + audit are mandatory and why the
  build turns live execution on last, per-gate-verified. A caps or kill-switch
  bug is now a money bug.
- The ADR-010 audit becomes three checks: (a) read connections have no write
  path, (b) each write module's allowlist + gates are intact, (c) the four
  autonomous gates fire (cap breach pauses, kill switch cancels, missing env =
  no order, non-eligible cannot promote) — each with a test.
- The compliance banner (ADR-011) changes again: Vantage now "executes
  operator-promoted strategies autonomously on Alpaca within hard caps," not
  only "operator-initiated reclaim tickets."
- Two live brokers, two gates, two allowlists to keep frozen and tested.

## Applies To

- ADR-010 (parent doctrine — append v4 amendment pointing here), ADR-011
  (compliance banner wording), ADR-008 (TLH stays advisory — unaffected),
  ADR-014 (backend/MCP surface — the MCP surface stays read-only; order routes
  are REST-only and never MCP tools).
- The strategy-lifecycle epic and its features (paper stage, promotion gate,
  autonomous execution, caps/kill-switch/audit, the Strategies UI).

## Amendment Log

- **v1 (proposed 2026-07-19):** autonomous strategy lifecycle on Alpaca —
  paper → gate (beat frozen backtest baseline) → manual promote → bounded
  autonomous live, behind four hard gates (kill switch + `VANTAGE_AUTONOMOUS_OK`,
  per-strategy caps, manual promotion, immutable audit log). Amends ADR-010 v4.
