# Hypothesis log — playbook-params

Metrics + fill rules identical to the prior two loops. Measurement command:
`server/.venv/bin/python -m vantage_server.backtest --multi-cache
backtest_data/bars_multi_frozen.json --params '{"entry_mode": "reclaim",
"trigger_interval": "5m", "confirm_closes": 3, <design override>}'`

Design parameters under test (prod defaults in parentheses):
- recent_sessions (10) — the swing window the chart dims read
- confluence_tol_pct (0.15) — zone clustering tolerance, % of spot
- min_zone_dims (2) — distinct dimensions a confluence zone needs
- pivot_n (2) — fractal pivot width (bars each side)
- durable_min_sessions (3) / durable_tol_pct (0.12) / durable_max_dist_pct (1.5)
- ladder_exclude ([]) — drop round / fib / poc rows from the ladder
- vp_bins (40) — volume-profile bin count

## E0 baseline
method: champion trigger, all design params at prod defaults.
value: (pending re-verification after the signature-extension refactor)
