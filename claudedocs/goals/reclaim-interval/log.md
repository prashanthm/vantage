# Hypothesis log — reclaim-interval

Metric definitions (fixed): win rate + profit factor exactly as in the
strategy-winrate loop (win = positive %-of-entry P&L; PF = gross win % /
gross loss %; unfilled tickets excluded). Measurement command:
`server/.venv/bin/python -m vantage_server.backtest --multi-cache
backtest_data/bars_multi_frozen.json --params '{"trigger_interval": "..."}'`

Treatment definition: "trading at interval X" = the reclaim close is detected
on X-minute bars AND stop/target settlement walks X-minute bars. (You can't
enter mid-15m-bar off a 5m close and still settle on 15m bars — the treatment
is the realistic one: the trader watches X-minute candles.)

Coverage note (frozen 2026-07-11): 5m/15m/30m/60m cover the same 60 sessions
(2026-04-15 → 2026-07-10); 2m covers only 30 (05-28 → 07-10, yfinance cap).
Main sweep therefore compares 5m/15m/30m/60m on the full window; 2m is judged
only in paired runs against 15m restricted to the 2m window (date_min
2026-05-28). The window shifted one session vs the prior goal's cache
(04-15 start vs 04-14), so E0 is re-measured, not assumed.

## E0 baseline: 15m reclaim on the multi cache
method: --multi-cache, params {"entry_mode": "reclaim"} (trigger_interval 15m).
prediction (sanity): ≈ prior cache's H6 (n≈42, WR≈0.50, PF≈1.29), ± a session
of drift.
result: n=42, WR 0.500, PF 1.289, net +1.40% — REPRODUCES the prior cache's
H6 exactly (the shifted first session falls inside warmup).
→ **adoption bar: WR ≥ 0.550 AND PF ≥ 1.289, split-half replicated.**
