# Hypothesis log — market-context-native

## E0 baseline
method: `curl /api/playbook?underlying=SPX` → regime.{vix,vix_band,breadth_pct_above_50ma};
grep bridge for /sentinel path reads
value: vix=None, vix_band=None, breadth=None. `market_context()` reads
`/sentinel/logs/market_context.json` (retired). No intermarket block. Edge untested.

## H1 native market_context module computes breadth+VIX-term+sectors+intermarket
prediction: a new `market_context.py` (store-backed sectors/SPY + live-fetched
VIX/VIX3M/DXY/TNX/oil/gold) returns available:True with non-null breadth
(pct_above_50ma over sector ETFs), vol (vix, vix3m, contango, stance), sectors[],
and intermarket{dxy,tnx,oil,gold each level+chg}. sentinel_bridge.market_context()
delegates to it → grep shows zero /sentinel reads on that path. Self-check passes.
experiment: write market_context.py + point the bridge at it.
result: market_context.py returns available:True source:vantage-native with
breadth(pct_above_50ma=57.1, ad_ratio=0.17, 7 sectors counted), vol(vix=18.77,
vix3m=20.54, contango=+1.77, stance=contango), intermarket(dxy/tnx/oil/gold all
live), sectors[] ranked by 20d return. Bridge delegates to it (AST-verified: body
calls only market_context+_missing, zero _logs_dir/_read_json). Playbook regime
widened (vix_term_stance, vix_contango, breadth_ad_ratio, intermarket, bullets);
stored SPX row + /api/spx/playbook now serve all fields. Self-check passes offline.
Note: only 7/11 sector ETFs primed with 51+ daily bars (XLV/XLI/XLY/XLC/XLU/XLB/XLRE
partial) — data-priming gap, not a code bug.
verdict: confirmed (predicate part 1 — populates natively, zero /sentinel reads)
kept: yes (pending commit)
