# Goal: open-ended-edge

**Outcome** — a frozen-tape-backed decision on what the live paper pipeline
does with target-less (open-ended) reclaim tickets, plus verdicts on the two
fill-time guards the 2026-07-16→22 live losses implicate (chase cap, same-side
dedup).

**Why now** — post-direction-gate live record is 0W/5L (−$2,175). Audit
(2026-07-22) showed 4 of 5 losses were `target=None` tickets: a class the
validating backtests structurally exclude (`simulate_fill` returns None on
target-less tickets), that bypasses the R:R 1.5 floor (`is_worth_taking`
allows open-ended), and whose 3×5m fills chased 3.4–5.4 SPY pts past the
level while stops stayed anchored at level−pad (fill risk up to 4.5× design
risk). Both loss-pairs (#28/#29, #83/#84) filled on the same closes at the
same price — double size on one idea.

**Success predicate** — all three pre-registered hypotheses classified
(confirmed/disproven/inconclusive) with measured WR/PF on the frozen tape,
AND the winning policy shipped to paper.py with a test — or an explicit
"no change" decision if all are disproven.

**Baseline (E0)** — champion re-measure: params
`{entry_mode: reclaim, trigger_interval: 5m, confirm_closes: 3}` on
`server/backtest_data/bars_multi_frozen.json`. Last measured (reclaim-
confirmations goal): n=34 WR 0.706 PF 2.99 net +4.55%. Reproducing it proves
the harness still measures what it did; drift → re-baseline and note why.

**Budget** — 10 experiments. **Trigger** — now.

**Constraints**
- Frozen bar caches untouched (append-only harness params; default behavior
  byte-identical when new params are unset).
- Research-only: no orders, no store writes (ADR-010).
- A live paper.py change ships ONLY if its hypothesis is confirmed here.

**Status**: ACHIEVED · started 2026-07-22 · closed 2026-07-22 — all three
pre-registered guards disproven; shipped the eod-close settlement discipline
instead (see log.md Decision).
