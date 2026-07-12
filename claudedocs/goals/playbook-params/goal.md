# Goal: evaluate + adjust the playbook's design parameters

- **Outcome**: Determine whether tuning the scaffold design parameters (swing
  window, confluence clustering, zone strength, pivot width, durable-level
  memory thresholds, ladder composition, volume-profile bins) improves win
  rate and profit factor beyond the adopted champion; adopt proven winners
  into `spx_playbook.py` defaults.
- **Baseline (E0)**: the adopted champion trigger (3×5m reclaim) on the frozen
  multi-interval cache: WR 0.600 / PF 1.387 / n=35. Every experiment runs under
  that trigger — the design parameter is the sole variable.
- **Success predicate**: ≥25 pre-registered experiments ending in either
  (a) a parameter change reaching **WR ≥ 0.63 AND PF ≥ 1.45 with n ≥ 28**,
  split-half replicated, adopted into prod defaults; or (b) all candidates
  measured and disproven — "current design stands" also satisfies.
- **Budget**: 25 experiments minimum. **Coordinator**: Opus.
- **Constraints**: paper/backtest only (ADR-010); branch `goal/playbook-params`;
  same frozen cache (`bars_multi_frozen.json`); predictions pre-registered;
  prod defaults change only for replicated winners; signature-extension
  refactors must keep E0 byte-identical.

Status: **achieved** · started 2026-07-11 · achieved 2026-07-11 ·
outcome (a): fractal pivot width 2→3 adopted (WR 0.600→0.706,
PF 1.387→2.990, orderly neighborhood, split-half replicated, transfers
across symbols and triggers). All other design params stand at current
values. 25 experiments (12 confirmed / 8 disproven / 3 mixed / 2
inconclusive). Full record in log.md.
