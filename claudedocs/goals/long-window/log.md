# Hypothesis log — long-window

Metrics + fill rules identical to prior loops. Measurement command:
`server/.venv/bin/python -m vantage_server.backtest --cache
backtest_data/bars_hourly_730d.json --params '{...}'`
(single-interval cache; scaffolds AND fills on hourly bars — coarser than
prod; only DIRECTIONAL mechanism verdicts transfer, never absolute numbers.)

Yearly halves for robustness: H1 = sessions ≤ 2025-07-10, H2 = sessions ≥
2025-07-11 (set per E0's actual coverage).

Mechanism verdict rule: REPLICATES = beats its control on BOTH WR and PF on
the full window AND directionally in each yearly half.

## E0 baseline
method: touch entries, prod design params (pivot_n 3 now default), hourly.
value: (pending freeze)
