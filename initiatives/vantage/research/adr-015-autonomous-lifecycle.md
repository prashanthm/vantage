# Research & Rubric — ADR-015: Autonomous strategy lifecycle execution (Alpaca)

Backing analysis for ADR-015. Two decisions are weighed: **execution-autonomy
level** and **broker**. Prior art is the existing Vantage codebase (Robinhood
carve-out, paper sim, backtest harness) and Alpaca's published API.

## Decision 1 — execution-autonomy level

How far does automation reach into the trade lifecycle?

| Option | Parity of validation | Closes the loop | Safety surface | Reuse | Verdict |
|--------|---------------------|-----------------|----------------|-------|---------|
| **A. Human-in-loop only** (status quo: reclaim ticket, human presses execute) | n/a | No — every trade is manual entry | Smallest (a human is the circuit-breaker) | Full | Rejected — the operator explicitly wants autonomous execution; retype step adds error risk without safety (ADR-010 v2 already found this for exits) |
| **B. Exits-only automation** (status quo v3: monitor closes, human opens) | n/a | Partial — opening still manual | Small (can only reduce exposure) | Full | Rejected — does not deliver autonomous strategies; opening is the whole point |
| **C. Paper-only, no live** | High (if broker paper ≈ live) | No live loop | Zero money | High | Rejected as the *end state* (operator wants live), but ADOPTED as the mandatory **first build stage** and validation gate |
| **D. Bounded autonomous live** (chosen) | High on Alpaca (native paper parity) | Yes | Largest — code opens real exposure; must supply caps + kill switch + audit to replace the human | High (mirrors robinhood_execution gating) | **Selected** — the only option that delivers the operator's goal; the enlarged safety surface is bounded by four hard, individually-tested gates |

**Sources:**
- Reuse / gating pattern — `brokers/robinhood_execution.py` (double env gate,
  frozen `EXECUTE_TOOLS` allowlist, `ExecutionViolation` before I/O, structural
  reduce-only). **Strong** (in-repo, live-verified 2026-07-12).
- "Human is the circuit-breaker" — ADR-010 §5 forbids any scheduler/loop from
  the entry path; v2/v3 amendment log. **Strong** (charter doctrine).
- Paper-predicts-live only with fill parity — general market-microstructure
  fact; a paper sim on broker X does not predict fills on broker Y. **Moderate**
  (well-established, not measured in-repo).

**Open risk (flagged, not papered over):** option D's safety rests on the four
gates being correct. Caps and the kill switch are new code with no prior art in
this repo — the Robinhood path never needed them because a human gated every
open. This is the highest-risk surface in the system; it is mitigated by
building live LAST, per-gate-verified against paper, and by an append-only audit
log, but a caps/kill-switch bug is a money bug. This risk is real and named
here rather than resolved by the verdict.

## Decision 2 — broker

| Option | Native paper parity | Multi-leg options API | Safety/reuse fit | Verdict |
|--------|--------------------|-----------------------|------------------|---------|
| **Alpaca** (chosen) | Yes — same API, `paper-api.alpaca.markets`; paper vs live is a URL/env flip | Yes — Level 3 multi-leg (spreads/straddles/condors) on one API | New module, mirrors robinhood_execution pattern | **Selected** — parity is what makes the promotion gate meaningful; options support is a hard requirement |
| **Robinhood** (existing carve-out) | No sanctioned API paper mode | No sanctioned options-order API | Already integrated (reads + the reclaim execute path) | Rejected — no paper parity (gate would be meaningless) and no multi-leg options order API; kept ONLY for the existing manual reclaim ticket |
| **IBKR** | Yes (paper account) | Yes (rich) | Heavy API, no in-repo prior art, larger integration surface | Rejected — more integration cost than Alpaca for the same capability; no reuse advantage; revisit only if Alpaca proves limiting |

**Sources:**
- Alpaca native paper endpoint + Level-3 multi-leg options — Alpaca public API
  docs. **Moderate** (vendor docs; to be confirmed against the live SDK during
  T2.2, and any gap flagged there).
- Robinhood lacks sanctioned API paper + options-order API — ADR-010 context
  (agentic equity-only path). **Strong** (in-repo).
- IBKR integration weight vs Alpaca — general industry knowledge, no in-repo
  measurement. **Weak** — treated as a tie-breaker only, not a load-bearing
  score.

**Open risk:** the Alpaca options/paper capabilities are asserted from vendor
docs, not yet exercised in this repo. T2.2 (the paper broker) must confirm
multi-leg paper order placement actually works before any options strategy is
promoted; if it does not, options strategies stay paper-blocked and the ADR's
"Level 3" claim is narrowed in an amendment.

## Rejected alternatives summary (for the ADR)

- **Human-in-loop / exits-only** — do not deliver autonomous strategies (the
  goal).
- **Paper-only as end state** — no live loop (but adopted as the first build
  stage + gate).
- **Robinhood for the lifecycle** — no paper parity, no options-order API.
- **IBKR** — higher integration cost, no reuse advantage over Alpaca.
