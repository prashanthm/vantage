# Goal: mira-inputs — what does Mira need to guide better?

status: ACTIVE · started 2026-07-24 · budget 12 experiments (confirmed)
scope: FORECASTS ONLY (confirmed — trade-review quality rides along unmeasured)

## Outcome
Mira is the intelligence layer; her guidance is only as good as her inputs.
Determine which ADDITIONAL inputs, FRESHNESS guarantees, and PROMPT changes
measurably improve the 15-minute forecast — ship confirmed ones, log the rest.

## Success predicate (measurable)
Replay hit-rate on the FIXED day set {2026-07-21 (trend down), 2026-07-23
(rally), 2026-07-24 (chop)} improves by ≥ +0.05 absolute over the E0
baseline, from changes each individually confirmed (≥ +0.03 lift alone, no
day regressing by > 0.10). hit-rate = forecasts scored "hit target" /
forecasts scored (noop/unscored excluded), pooled across the three days.

## Baseline (E0)
The headless harness (server/research/mira_replay.py) replays each fixed day
step-by-step with the CURRENT prompt + snapshot: plan → per-step snapshot →
buildForecastPrompt (verbatim port) → Mira /turn → save with run_id → code
score. E0 = pooled hit-rate, no modifications.

## Constraints
- Measurement instrument frozen: same days, same step cadence, same scorer
  for every experiment. Prompt/input is the ONLY variable per run.
- Predictions written to log.md BEFORE each run (standing goal discipline).
- Confirmed input changes ship server-side (snapshot/prompt), not just in
  the harness; freshness fixes ship with a stamp the UI can show.
- Live pipeline untouched until a change is confirmed on replay.

## Candidate hypothesis backlog (pre-registered as picked up)
- H-fresh: freshness audit — every input block in the snapshot gets an age;
  stale blocks (> 2× cadence) are DROPPED from the prompt rather than cited.
- H-cal: economic-calendar block (FOMC/CPI/OPEX day flags).
- H-chain: intraday 0DTE chain-flow deltas from OUR chain_snaps archive.
- H-vol: implied-vs-realized (odte read) into the forecast prompt.
- H-selffeed: Mira sees her last 3 scored verdicts for the day (self-correction).
- H-overnight: globex/ES overnight range + gap context.
- H-breadth: intraday breadth refresh (market_context is daily-cadence today).
- H-prompt: prompt-side — tighten the DISCIPLINE rules with examples of the
  day's actual failure modes (born-invalid, chasing met targets).
