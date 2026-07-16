# ICT-informed live-coach feature set — validated design

Derived from the operator's two indicators (`liq-levels-mtf.pine`,
`t4t-high-prob-ob.pine`), ICT concepts, and **backtested against 48 real SPX 0DTE
trades over 4 sessions (07-13..16) at 1m resolution**. Every feature below carries
a verdict from that backtest. This is the plan for the **Vantage-native** live
coach (a Pine indicator cannot fetch/reason live — see the constraint note).

> **Sample caveat (applies to all):** 48 trades, 4 sessions, buckets of 6–27.
> Verdicts are directional and indicative, not conclusive. The 1m sample grows
> automatically (persistence is shipped); re-run before building each feature.

---

## The one thing the data screams

**Trading a playbook LEVEL without corroborating structure — or with the HTF
context against you — is where the operator loses money.** It showed up in five
independent tests:

| Test | level-only / against | clean / with |
|---|---|---|
| FVG goal (last wk) | level-only **−$218** avg | level+FVG **+$867** |
| H3 (level×OB) | level-only **−$29** (worst) | neither +$230 |
| H5 (opposing OB) | level+opposing-OB **lost 100%** | level-clear +$3 |
| H8 (level draw) | against-draw **−$357** avg | with-draw **+$270** |
| H9 (timing) | **lvl_midday −$1,446** avg (−$8,676!) | lvl_open90 +$689 (WR 1.00) |
| H10 (combined) | flagged 13 = **−$5,644** | clean 8 = **+$5,035** |

The coach's highest-value ICT feature is **a WARNING on low-conviction level
entries**, not a new positive entry trigger. Every attempt to build a *positive*
ICT trigger (sweep, OB proximity, 1m-FVG draw) failed to validate.

---

## Features, ranked by validated P&L impact

### 1. ⭐ MIDDAY-LEVEL WARNING  — verdict: **CONFIRMED (strongest)**
When price is at a playbook level during **11:00–14:00 ET**, flag the setup
**LOW CONVICTION — midday level trap**. H9: midday level trades went WR 0.17,
**−$8,676 net** (≈ the entire weekly loss); open-90 level trades won 100%.
- *Build:* trivial — the coach already knows the time and the level. A red banner
  + a Telegram note. **Highest impact, lowest effort.**

### 2. ⭐ AGAINST-THE-DRAW WARNING (HTF/level-based) — verdict: **CONFIRMED**
At a level, compute the **nearer opposing playbook level** as the draw. If the
trade is *against* it (long at 7550 with max-pain 7529 the nearer magnet below),
flag **AGAINST THE DRAW**. H8: with-draw +$270 avg vs against-draw −$357.
- *Critical:* the draw is an **HTF / level-ladder construct, NOT a 1m FVG.** The
  1m-FVG draw (H6/H7) INVERTED (−$3,761) — do not use it.
- *Build:* the coach already has the level ladder; pick the nearer opposing level,
  compare to trade direction.

### 3. ⭐ COMBINED LOW-CONVICTION FLAG — verdict: **CONFIRMED (end-to-end)**
The shippable synthesis of #1+#2: at a level, flag if **midday OR against the
level-draw**. H10: the 13 flagged trades = −$5,644; the 8 clean = +$5,035. One
filter isolates almost all the level losses.
- *Build:* this is THE feature. A single "conviction" verdict on every level
  entry (CLEAN / LOW — midday / LOW — against draw), on-chart + Telegram.

### 4. LIQUIDITY MAP + MITIGATION (from liq-levels-mtf) — verdict: **CONTEXT
(engine ported, not an entry edge)**
Port the pivot-based BSL/SSL liquidity pools + mitigation tracking + the HTF
variant. Show unswept liquidity above/below and mark grabs live. E0 confirmed the
engine reproduces the chart structures.
- *Not* an entry signal on its own (H1: raw sweep disproven — too common at 1m).
  Value is **narrative/context**: "unswept SSL at 7506 below (Monday), BSL 7580
  above" — the map the operator reasons over.
- *Build:* medium. Powers the "what should price do" narrative (#6).

### 5. ORDER-BLOCK / BREAKER ENGINE (from t4t) — verdict: **INCONCLUSIVE at 1m**
Port the sweep+displacement+FVG OB detector + breaker conversion (E0: faithful).
BUT H2/H4: OBs are too rare/small on 1m to coincide with the operator's fills, so
OB-proximity did not validate as an entry filter.
- *Build:* LOW priority as a signal. Keep as **displayed context** (the OB/BRKR
  zones the operator already trusts on the chart) and re-test edge as data grows.

### 6. "WHAT SHOULD PRICE DO?" LIVE NARRATIVE — verdict: **DESIGN (built on the
above, not independently tested)**
The operator's core ask. A Vantage-native, per-bar-close read that combines the
liquidity map (#4), the level ladder, the draw (#2), OB context (#5), and FVGs,
written by Mira: *"grabbed the 7506 Monday liquidity, reclaiming toward max-pain
7529; nearest draw is 7529 below — a long here is against the draw, low
conviction midday."* Pushed to the SPA panel + the Telegram webhook.
- *Build:* the big one. Requires the Vantage-native coach loop (below). Its
  *inputs* are validated (#1-#4); the narrative synthesis itself is Mira prose.

---

## The architecture constraint (why this is Vantage-native, not Pine)

A TradingView Pine indicator is sandboxed: no external fetch, no LLM, no live
playbook read. Features #2/#6 need HTF liquidity + the playbook + Mira reasoning
each bar — **impossible in Pine.** So the live coach must run in Vantage:

```
every 5m bar close → pull live price + the day's playbook + prior-session
liquidity (persisted 1m bars) → compute: at-a-level? draw direction? midday?
liquidity grabs? OB/FVG context → Mira writes the narrative + conviction verdict
→ push to SPA panel + Telegram (webhook already wired)
```

The current Pine coach stays as the lightweight on-chart companion (levels +
trade ticket + the direction-gated READ we just fixed). The **intelligence** moves
to Vantage.

---

## Recommended build order

1. **#3 Combined low-conviction flag** — add to the trade DNA + the existing Pine
   coach's baked context first (midday + against-level-draw are both computable
   from data the coach already has). Ships value immediately, no new service.
2. **#4 Liquidity map** — port `liq-levels-mtf` to the backend; surface in DNA +
   SPA. Foundation for the narrative.
3. **#6 Vantage-native coach loop + narrative** — the bar-close service, Mira
   synthesis, SPA/Telegram push. The big build; do it once #1/#4 are in and the
   1m sample is larger.
4. **#5 OB/breaker** — displayed context; re-test the edge as data accrues.

Nothing here is built yet (goal constraint). Re-run the H-series
(`ict_features.py`) on the larger sample before committing each feature.
