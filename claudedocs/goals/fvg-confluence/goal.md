# Goal: does {level + fresh-FVG} confluence separate the operator's winners?

- **Outcome**: Decide, on evidence, whether adding Fair-Value-Gap confluence to
  the entry read is worth building into the DNA / coach / Mira analysis. The
  operator trades FVG retraces toward the draw; the whole system is currently
  FVG-blind (no FVG computed anywhere — confirmed in session_activity /
  coach_pine / trade DNA).

- **Success predicate**: On the operator's REAL SPX 0DTE trades for the sessions
  in question (2026-07-15, -16), bucket each entry by confluence and compare P&L:
  entries with {near a playbook level AND entering a fresh unfilled FVG in the
  trade direction} vs entries with only one leg vs neither. The FVG leg is
  VALIDATED as useful if the 2-leg bucket's win rate AND avg P&L both clearly
  beat the level-only bucket (directionally; n is small so this is indicative,
  not conclusive). Disproven if FVG confluence does NOT separate them.

- **Baseline**: measure the level-only correlation the system uses today (the
  bucket with a level but no FVG).

- **Budget**: 5 experiments. Trigger: now.

- **Constraints**: analysis only, no orders. FVG = deterministic 3-candle
  imbalance on 1m/5m bars (reproducible). Order blocks / CHoCH from the
  operator's LuxAlgo indicator are NOT reproduced — only the FVG leg is tested.
  Bars fetched live (frozen cache ends 07-10, before these sessions).

- **Honest caveats**: 1-2 sessions, ~15-27 trades — indicative only. Only the
  FVG leg is testable here; the operator's full method (FVG + OB + sweep) may be
  stronger than the FVG leg alone shows.

Status: **blocked (inconclusive) — needs 1m data** · started 2026-07-16 · confirmed the system is FVG-blind by construction; FVG mechanism computes fine but the EDGE is untested (07-15/16 1m bars unfetchable; frozen cache is 15m, too coarse for 1m FVGs)
