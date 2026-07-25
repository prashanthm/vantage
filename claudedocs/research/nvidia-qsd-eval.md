# NVIDIA quantitative-signal-discovery-agent — evaluation for Vantage (2026-07-25)

Blueprint (Apache 2.0, ~64★): three NAT-orchestrated agents (Signal → Code
→ Eval) that LLM-generate formulaic alphas over S&P 500 OHLCV (operator DSL:
TS_Return, Decay_Linear, …), backtest by cross-sectional rank-IC, and
iterate until |IC| ≥ 0.02 and p ≤ 0.05.

## Fit assessment

- **Signal class: DIFFERENT.** It mines cross-sectional ranking alphas
  (portfolio tilts over hundreds of names). Vantage trades event/level
  setups (reclaims, breakout-holds, 0DTE structure). Their output is not
  directly tradable in Vantage's books.
- **Validation methodology: WEAKER THAN OURS — the deal-breaker.** The
  loop iterates candidates against the SAME eval set until the threshold
  passes: a textbook garden-of-forking-paths. p-values are invalid under
  that search; |IC| ≥ 0.02 is a low bar even before multiplicity. No
  held-out period, no purged CV, no transaction costs/turnover, no
  stability split. Vantage's own history is the counterexample: the
  level-folklore goal (10 placebos), the 57% wall, and this week's
  mira-inputs placebo (17% step-flip noise) all exist precisely to catch
  what this blueprint's acceptance rule would wave through.
- **Stack: redundant.** NAT orchestration duplicates Mira/LangGraph; the
  NVIDIA-endpoint default duplicates the DeepSeek gateway; Brev/GPU is
  unnecessary for API-driven work.

## Worth stealing (adapter, not adoption)

1. **The operator catalog + formula DSL as a HYPOTHESIS GENERATOR.** The
   genuinely good idea: a compact, typed search space of signal
   expressions an LLM can enumerate. Bolted onto OUR pipeline —
   LLM proposes formulas over the scanner universe; each survivor is
   pre-registered and judged by the frozen-tape harness with halves
   stability + placebo-calibrated bars — it becomes a wave-3
   scanner-families feeder with honest validation. Their generate/code
   agents are ~small prompts; the catalog file is the vendorable part.
2. **Rank-IC as a screening metric** for cross-sectional ideas (the
   universe scanner already ranks 162 names) — as a FIRST filter only,
   never an acceptance criterion.

## Recommendation

DON'T deploy the blueprint. Its closed loop automates exactly the mistake
Vantage's goal discipline exists to prevent (iterating against the eval
set until significance appears). DO lift the operator-DSL hypothesis
generator into a future scanner-families wave, with our validation
replacing theirs. Effort if picked up: ~a day (vendor catalog, prompt,
feed the existing frozen harness).
