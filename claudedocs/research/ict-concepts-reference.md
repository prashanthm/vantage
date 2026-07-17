# ICT Concepts — Enumerated Reference, with Combinations & Timeframes

A structured enumeration of Inner Circle Trader (Michael J. Huddleston) concepts:
what each is, how it's identified, how ICT proposes it be **used**, what it
**combines** with, and on what **timeframe**. Compiled from a four-part research
sweep (market structure & liquidity · PD arrays & entries · time & sessions ·
models & workflow).

Two things make this reference *yours* rather than generic:
1. A **"Vantage" column** maps each concept to what `server/vantage_server/ict.py`
   already computes, and to the verdicts from your two backtested goals
   (`ict-coach`, `ipda-edge`).
2. Every claim is flagged **canonical ICT** vs **community/SMC variant**, and
   **narrative** (unvalidated) vs **backtested** where you've measured it.

> **Framing caveat (applies throughout).** ICT teaches these as *discretionary,
> heuristic* concepts, not mechanically backtested edges. Where you HAVE tested
> them on SPX, the edge was narrow or absent (see the two goal callouts). Read
> this as "the vocabulary and the proposed logic," not "proven signals."

---

## 0. The one organizing idea

For ICT, **liquidity is the cause; price movement toward it is the effect.**
Structure (BOS/MSS/CHoCH) is a *lagging* read; liquidity + the PD-array framework
are the *leading* read. Almost every model below is one skeleton:

> **HTF bias (draw on liquidity)** → **sweep** of obvious liquidity → **displacement
> / MSS** (leaves an FVG/OB) → **retrace into that PD array** in the correct
> premium/discount → **target the opposite liquidity (the draw).**

Everything else is a specialization of that loop by *which array*, *what time*,
and *what confirmation*.

---

## 1. MARKET STRUCTURE

| Concept | What it is / how identified | ICT use | Combines with | Timeframe | Vantage |
|---|---|---|---|---|---|
| **Swing high / low (fractal)** | 3-candle fractal: middle candle's high > both neighbours (high) or low < both (low). Nested into short-/intermediate-/long-term highs (STH/ITH/LTH). | The atomic unit; every swing = a liquidity pool (stops beyond it) and an anchor for a dealing range. | Liquidity (BSL/SSL), dealing range, BOS/MSS. | All. | ✅ `pivots(hi,lo,n=2)` — confirmed fractal pivots. |
| **Break of Structure (BOS)** | **Body close** beyond a prior swing *in the trend direction* = continuation. A wick-through that fails is a *sweep*, not a BOS (key ICT distinction). | Confirms trend intact → keep trading with-trend; enter on the retrace into the OB/FVG left by the BOS leg. | OB/FVG (the displacement leg), draw on liquidity, IRL/ERL. | HTF bias frame, confirmed on execution frame. | Partial — engine detects displacement + sweeps but doesn't label BOS explicitly. |
| **Market Structure Shift (MSS)** | Early **reversal** signal: break of a short-term swing *against* trend **with displacement** (body close + FVG). | The trigger to flip bias; enter on the retrace into the FVG/OB the shift created, target opposite liquidity. Backbone of the 2022 & Silver Bullet models. | Sweep (almost always precedes), displacement, FVG, OB, OTE, DOL. | Any; classic on 15m/5m/1m after an HTF reaction. | Partial — displacement + FVG are computed; MSS labeling is derivable, not emitted. |
| **Change of Character (CHoCH)** | First counter-trend break of the last opposing swing. **Near-synonym of MSS**; community treats CHoCH = any break, MSS = break *with displacement*. | Weaker early warning of reversal. ICT demands **displacement** before acting. | Same stack as MSS. | All. | Not labeled. **Flag:** CHoCH is an SMC-popularized term; ICT's native term is MSS. |

**Canonical vs SMC:** ICT requires a **body close** for a BOS and **displacement**
for a valid shift. Mechanical SMC often accepts any wick break — the most common
fidelity error. Your `ict-coach` goal found **raw sweeps disproven at 1m** (too
common), which is consistent: the sweep alone isn't the signal; sweep+displacement
is what ICT actually teaches.

---

## 2. LIQUIDITY

| Concept | What it is / how identified | ICT use | Combines with | Timeframe | Vantage |
|---|---|---|---|---|---|
| **Buy-side / Sell-side liquidity (BSL/SSL)** | BSL = buy stops resting *above* highs; SSL = sell stops *below* lows. Named by resting **order type**, not who profits. | The **targets** and the **fuel**: price is pushed into a pool to fill size against retail stops, then often reverses. | DOL, IRL/ERL, sweeps, MSS. | All; HTF pools = strongest magnets. | ✅ `unswept_liquidity(hi,lo)` → `{bsl, ssl}` pivot pools not yet taken. |
| **Liquidity pool / resting liquidity** | Concentration of resting orders at an obvious level (beyond swings, EQH/EQL, session/PDH-PDL, round numbers). Synonyms. | The menu of targets; daily bias = "which pool is price drawn to next." | DOL, killzones, PD arrays. | All; session/daily pools are the workhorse. | ✅ same engine; surfaced as the "liquidity map" (design-doc #4). |
| **Equal highs / lows (EQH/EQL)** | 2+ highs/lows at ~equal price = engineered liquidity (obvious → rich stops). | Premier **draw** targets ("almost always get run"); also bias confirmation. | DOL, sweeps, MSS. | All; very reliable intraday. | Derivable from pivots; not explicitly clustered as "equal." |
| **Trendline liquidity** | Stops resting along an *obvious* diagonal trendline (engineered, not S/R). | **Fade** the clean trendline break — it's usually a raid that reverses. | Sweeps, MSS, DOL. | All. | Not modeled. |

---

## 3. LIQUIDITY EVENTS (sweep / raid / stop hunt / run)

| Concept | Identified | ICT use | Combines with | Timeframe | Vantage |
|---|---|---|---|---|---|
| **Sweep / raid / stop hunt / liquidity run** | Price trades **beyond** a level, fails to sustain, closes back inside (long-wick stop-run candle). A break **without** a body close = sweep, not BOS. | Don't front-run it — wait for the pool to be taken, then MSS+FVG/OB entry *against* the sweep toward the opposite pool. "Sweep then displace" = the core entry. | MSS/CHoCH, FVG/OB (entry), Judas swing, DOL. | All; killzone sweeps are the staple. | ✅ sweep detection inside `order_blocks()` (sweep+displacement+FVG). **Backtested:** raw sweep as an entry filter **DISPROVEN at 1m** (too common) — `ict-coach` H1. |

Four terms, one mechanic. Sub-nuance ICT honors: a *run* can mean running
*through* one level to reach a farther pool (continuation); a *sweep/raid*
connotes take-and-reverse.

---

## 4. RANGE-RELATIVE LIQUIDITY & THE DRAW

| Concept | What it is | ICT use | Combines with | Timeframe | Vantage |
|---|---|---|---|---|---|
| **IRL vs ERL** | In a dealing range: **ERL** = liquidity at the extremes (the swing highs/lows = stops); **IRL** = inefficiencies *inside* (FVGs/OBs). IRL ≈ inefficiencies, ERL ≈ swing-point stops. | Price oscillates **ERL → IRL → ERL**: takes an external high, turns to fill an internal FVG, then re-targets external liquidity. A rhythm for sequencing targets. | DOL, FVG, OB, premium/discount. | All; relative to a chosen range. | Not modeled as IRL/ERL, but the pieces exist (liquidity + FVGs). |
| **Draw on Liquidity (DOL)** ⭐ | The **magnet**: the liquidity target price is most likely being pulled toward *right now*. A judgment, not a pattern — synthesized from nearest untapped pool + HTF premium/discount + unfilled HTF FVGs. | **DOL *is* your directional bias.** Every entry should be in the direction of the draw. ICT's crown concept — the thing SMC most under-weights. | Everything: premium/discount, IRL/ERL, BSL/SSL, EQH/EQL, HTF FVGs, MSS. | HTF for bias, LTF to execute. | ✅ `draw_from_levels(price, levels)` = nearer opposing **playbook level**. **Backtested:** the level-based draw is the **validated magnet** (`ict-coach` H8: with-draw +$270 vs against-draw −$357). ⚠️ The **1m-FVG draw INVERTED** (−$3,761) — do NOT use a low-TF FVG as the draw. |

> **This is your strongest confirmed ICT feature.** The draw works when it's an
> **HTF / level-ladder** construct (nearest opposing playbook level), and *fails*
> when computed from a 1m FVG. Trading **against** the draw is a money leak.

---

## 5. PREMIUM / DISCOUNT & OTE

| Concept | What it is | ICT use | Combines with | Timeframe | Vantage |
|---|---|---|---|---|---|
| **Dealing range · equilibrium · premium/discount** | Fib over a range: 50% = equilibrium; >50% = **premium** (sell); <50% = **discount** (buy). Institutional "buy low/sell high." | **Only buy in discount, only sell in premium**, in the direction of the draw. Enter a *bullish* array in discount, a *bearish* array in premium. | OTE, OB/FVG (must sit in the right half), DOL, IRL/ERL. | All. | Not modeled (no equilibrium calc). Candidate add. |
| **OTE (Optimal Trade Entry)** | The **0.62–0.79** retracement of an impulse, **0.705** = sweet spot (ICT-specific, not a std Fib level). | Precision entry that stacks deep discount/premium + a PD array. Strongest when the OTE zone **overlaps an FVG/OB**. Stop beyond the origin; targets = fib extensions / opposite liquidity. | MSS+sweep (context), FVG/OB (confluence), premium/discount, SD projections. | Execution TF (5m/1m) off an HTF leg. | Not modeled. **"70.5%" is the ICT-fidelity marker** vs generic Fibonacci. |
| **Standard-deviation projections** | ICT's label for **symmetrical fib extensions** (−1/−2/−2.5 "SD") beyond a range — *not* statistical σ. | Target-setting: project from the consolidation/sweep leg; where an SD level lands on a real old high/low or FVG = high-probability target. | DOL, IRL/ERL, FVG, OTE. | All; HTF consolidations frame the day/week objective. | Not modeled. |

---

## 6. PD ARRAYS (the entry/target zones)

ICT's catalog, ranked by his **teaching emphasis** (not a published table — the
real strength driver is *confluence*, not array type):

| Rank | Array | Identified | ICT use | Vantage |
|---|---|---|---|---|
| 1 | **Order Block (OB)** | Last opposing candle before a displacing move that breaks structure. Bull OB = last down-candle before an up-displacement. Validity needs **displacement** (+ ideally a sweep and an FVG). | Enter on the **first** return to an *unmitigated* OB in the correct premium/discount; target opposite liquidity. | ✅ `order_blocks()` = sweep+displacement+FVG; `active_obs()` tracks unmitigated. **Backtested INCONCLUSIVE at 1m** (too rare/small to coincide with fills) — keep as *context*, re-test as data grows (`ict-coach` #5). |
| 2 | **Fair Value Gap (FVG) / imbalance** | 3-candle gap: bull = space between candle-1 high & candle-3 low (mirror for bear). **BISI** = bullish FVG, **SIBI** = bearish FVG (directional labels, same object). | Primary intraday entry & target; return to the gap (often to **CE**) then continue. Unfilled FVGs are magnets. | ✅ `fresh_fvgs()` = unfilled gaps. **Backtested:** FVG **confluence** with a level was the biggest separator (level-only −$218 vs level+FVG +$867) — but as a standalone *draw* it inverted. Value is as a **filter**, not a trigger. |
| 2b | **Consequent Encroachment (CE)** | The **50% midpoint** of an FVG (also of gaps/voids). | The precise entry trigger; price often only needs to reach CE to "respect" the gap. | Derivable (mid of `fresh_fvgs` hi/lo); not emitted. |
| 3 | **Breaker block** | A failed OB whose swing **had its liquidity swept**, then structure broke the other way → polarity flip. | Trade the retest in the new direction; strong because it = sweep + BOS + flip. | ✅ engine ports breaker conversion (design-doc #5). |
| 4 | **Mitigation block** | Failed-swing OB **without** a liquidity sweep (vs breaker, which has one). | Retest entry; slightly weaker than a breaker. | Not separately labeled. |
| 5 | **Inversion FVG (IFVG)** | An FVG traded fully through, then flips polarity (the FVG analogue of a breaker). | Trade the retest of the failed gap in the new direction. | Not modeled. |
| — | **Rejection block** | Wick-defined (not body): cluster of long wicks rejecting a level. | S/R on the return to the wick zone; marks where stops were purged. | Not modeled. |
| — | **Liquidity void** | Tall one-sided vacuum (often *contains* FVGs). | Expect a rebalance (fill); target/magnet. | Not modeled. |
| — | **Volume imbalance** | Body-to-body gap with overlapping wicks (no true empty space, unlike FVG). | Minor S/R magnet; confluence. | Not modeled. |
| — | **Opening gaps (NDOG/NWOG)** | Prior-close → new-open gap (New Day / New Week Opening Gap). | HTF reference lines & fair-value anchors; CE is a draw. | Not modeled. |

**Displacement** is the cross-cutting **validity filter**: an OB/FVG is only
"real" if the move that made it was displacement (large bodies, leaves an
imbalance, breaks structure). ✅ Vantage: `disp_mult=0.7*ATR` inside `order_blocks`.

**Synonym guardrails (avoid double-counting):** FVG = imbalance = inefficiency;
BISI/SIBI = bullish/bearish FVG; IFVG vs breaker = gap-flip vs swing-flip;
mitigation-block vs breaker = no-sweep vs sweep; rejection-block vs OB =
wick-defined vs body-defined; void vs FVG = multi-candle vacuum vs 3-candle gap;
"mitigation" (the *process* of returning to an array) vs "mitigation block" (the
*structure*).

---

## 7. TIME & SESSIONS (all ET)

The **time layer** the price tools hang on. Loop: **time filter → price trigger →
target.**

### Kill zones (index-futures set, SPX-relevant)
- **London Open 02:00–05:00** · **NY AM 08:30–11:00** · **NY Lunch 12:00–13:00**
  (avoid) · **NY PM 13:30–16:00**.
- Use: only hunt setups *inside* a killzone; killzone = the *when*, a PD array at
  liquidity = the *where*.

### Macros (~20-min algorithmic windows)
- Canonical: **09:50–10:10** and **10:50–11:10** (also 02:33–03:00, 04:03–04:30,
  08:50–09:10, 11:50–12:10, 13:10–13:40, 15:15–15:45).
- Use: inside the macro, expect a sweep → delivery toward the session draw. For
  *timing* entries once bias is set, not for setting bias. 1m/5m.

### Session opens (reference prices)
- **Midnight / True Day Open 00:00** (the algo's day start; premium/discount
  pivot & bias anchor) · **08:30** (news driver) · **09:30** (cash open, frequent
  Judas). Draw a ray from the open; use position relative to it as bias.

### Silver Bullet (fixed 1-hour FVG windows)
- **London 03:00–04:00** · **NY AM 10:00–11:00** (best) · **NY PM 14:00–15:00**.
- Rules: (bias) → **displacement leaves an FVG in the hour** → enter at FVG **CE/50%**
  → stop beyond the swept wick → target opposite liquidity. Mechanical, one clean
  FVG is enough. 1m/5m.

### Power of 3 (PO3 / AMD) & Judas Swing
- Every session/daily candle = **Accumulation → Manipulation → Distribution**.
  **Judas Swing** = the manipulation: a false move at London/NY open that raids
  the *wrong*-side stops, then reverses into the true direction.
- Use: don't chase the open; wait for the Judas to sweep & fail, trade the
  reversal. The Judas extreme often becomes the day's high/low (stop reference).
- ✅ Vantage relevance: your **midday-level trap** finding is a time-of-day
  effect in the same spirit — see the callout below.

### Day-of-week / seasonals (probabilistic context)
- Weekly high/low typically forms **Mon–Wed** (ICT stresses **Tuesday** / **Wed
  London open**). Mon = accumulation; Thu = distribution/reversal; Fri =
  retrace. Seasonals = longer directional lean. Use to time *when* the weekly
  extreme forms and align intraday trades.

### Quarterly Theory / 90-min cycles (community extension)
- Split any container into 4 quarters (AMD-mapped), fractally. NY 90-min blocks:
  **Q1 06:00–07:30 · Q2 07:30–09:00 · Q3 09:00–10:30 · Q4 10:30–12:00**. Flag:
  a community formalization (Traderdaye), not always taught verbatim by ICT.

### IPDA & IPDA data ranges — ⚠️ BACKTESTED: NO EDGE
- **IPDA** = the "Interbank Price Delivery Algorithm," ICT's framing that one
  algorithm delivers price to seek liquidity / rebalance inefficiency. A framing
  device, not a verifiable algorithm. **IPDA data ranges** = 20/40/60 trading-day
  lookback highs/lows/equilibria, proposed as draw targets.
- **Your `ipda-edge` goal disproved these on SPX** (3-yr hourly, ~670 OOS days):
  no reversal edge (+2.3pp, ns, robust over 12 param configs); the apparent
  magnet edge (+10.3pp, p<0.0001) was a **distance artifact** — killed to +1.9pp
  (ns) by a distance-matched null. Equilibrium worthless. **Removed from the
  chart.** `ict.ipda_ranges` remains only for the backtest harness.

---

## 8. NAMED MODELS (the combinations, in order)

Every model = the §0 skeleton specialized. Sequences in ICT's canonical order.

### 8.1 The 2022 Mentorship Model (the reference implementation)
1. **Daily bias** (Daily + 4H) *before* the session. Neutral → no trade.
2. Mark the **00:00→03:00** reference range (its H/L = targets).
3. Wait for **London (03:00) / NY (08:30) open**.
4. **Liquidity sweep** of the range extreme opposite to bias (the Judas).
5. **MSS** on LTF (5m/3m/1m) back in the bias direction.
6. **Displacement** (body close + FVG) — validates the MSS.
7. Mark the **PD array** left by the displacement (FVG primary, else OB/breaker/IFVG).
8. **Premium/discount** check — array on the correct side.
9. Wait for the **retrace** into the array (don't chase).
10. **Enter** at the array tap · **stop** beyond the swept extreme · **target** the
    opposite range end / next pool · **min 1:3 R:R**.
**A+ gate:** correct bias + session sweep + LTF MSS-with-displacement. Missing one → stand aside.

### 8.2 Silver Bullet
2022 model **time-boxed** to a 1-hour window (10:00–11:00 best). Precondition:
target liquidity swept before/early in the hour. Entry at FVG **50% (CE)**; scale
50/25/25 at successive liquidity pools; min 1:2 to first target. One per day.

### 8.3 Unicorn (Breaker + FVG **overlap**)
Entry = the **price-range overlap** of a breaker and an FVG from the *same*
displacement leg. Overlap required — proximity doesn't qualify (the fidelity
test). 15m identify, 5m/3m entry. Stop 10–20 beyond the zone; ≥1:2.

### 8.4 Turtle Soup (false-breakout reversal)
Sweep an obvious pool (EQH/EQL, PDH/PDL, session extreme) → **fails to continue**
→ MSS back → enter → stop beyond the sweep wick → target opposite pool. **Failure
mode:** if the level isn't the true draw (institutions still want it run), the
"reversal" is only a pause — hence the HTF-bias prerequisite.

### 8.5 OTE model
Fib on the impulse → enter **0.62–0.79** (0.705 sweet spot) → stop beyond 1.0 +
~1×ATR → TP1 at 0.0, extensions −0.27/−0.62. Strongest when an FVG/OB sits inside
the zone.

### 8.6 Judas / PO3 / Asian-range / London-raid
The session-narrative engine under the above: Asian range (20:00–00:00) =
accumulation & the pool London raids; the London-open sweep of the Asian extreme
= the Judas = Turtle-Soup mechanic applied to the session.

---

## 9. MULTI-TIMEFRAME WORKFLOW (top-down — the answer to "what timeframe")

**Read top-down, never bottom-up. HTF = direction; LTF = execution. The 5m must
agree with the Daily.**

| Tier | Timeframe | Role | You do |
|---|---|---|---|
| **BIAS** | Monthly/Weekly/**Daily** (+4H) | Direction + narrative | Mark PDH/PDL, weekly H/L, daily OB/FVG/pools → bullish/bearish/neutral. |
| **DRAW / STRUCTURE** | **4H** → 1H | The **target** + structure | EQH/EQL & swing liquidity = the draw; watch BOS/MSS. |
| **SETUP** | **1H** → 30m | Reaction zone | The OB/FVG/breaker where price should react, aligned to bias. |
| **ENTRY** | **15m → 5m → 1m** | Trigger | LTF sweep + MSS + small FVG; enter on the retrace. Never set bias here. |

**Pairings ICT recommends** (structure TF → entry TF, ~3–5× lower): swing =
W/D→4H/1H; **day-trade (default) = Daily→4H→15m→5m**; scalp = 15m→1m. The exact
numbers are examples — the *principle* (entry TF agrees with bias TF) is the rule.

**Nested confluence = the structural definition of A+:** a 5m FVG *inside* a 4H OB
*inside* a daily discount zone. Each lower tier shrinks the stop while keeping the
HTF target.

---

## 10. CONFLUENCE — A+ vs stand-aside

**A+ stack (all aligned, same price & time):** ① clear HTF bias → ② sweep of a
meaningful pool → ③ displacement → ④ MSS in bias direction → ⑤ FVG/OB in the
correct premium/discount → ⑥ inside a killzone → ⑦ bonus: OTE 62–79% and/or nested
in an HTF array.

**Low-probability / stand aside:** neutral bias · no liquidity swept first · weak
displacement · entry outside a killzone / after the manipulation · array on the
wrong premium/discount side · chasing the MSS · fading a level that isn't the true
draw. **One full-confluence killzone setup per day is the target.**

**Trade management:** stop **beyond the swept wick + buffer** (never on the exact
extreme — the sweep overruns by a few ticks). Target = the **draw on liquidity**
(HTF pool), not an arbitrary R multiple. Scale at successive pools (IRL→ERL,
~50/25/25). R:R floors: 2022 = 1:3, Silver Bullet/Unicorn = 1:2, pre-validated
before entry.

---

## 11. What YOUR data says (the reconciliation)

Your two backtested goals are the reality check on the theory above:

**Confirmed on your trades (`ict-coach`, 48 SPX 0DTE trades, 1m):**
- **Against-the-draw is a money leak** — trading a level against the nearer
  opposing **playbook-level** draw: −$357 avg vs +$270 with-draw. The DOL concept
  (§4) is validated **as a level-ladder construct.**
- **Level+FVG confluence** beats level-only (+$867 vs −$218). FVGs earn their keep
  as a **filter**, not a standalone signal.
- **Midday-level trap** — a level entry 11:00–14:00 ET went WR 0.17, −$8,676 net.
  This is a *time* effect (§7 spirit) and your single strongest ICT-adjacent edge.
  The coach's highest-value feature is a **low-conviction WARNING**, not a new
  positive trigger.

**Disproven / inconclusive on your trades:**
- **Raw sweep** as an entry filter — too common at 1m (`ict-coach` H1). Matches
  ICT: sweep *alone* isn't the signal; sweep+displacement is.
- **1m-FVG as the draw** — inverted −$3,761. The draw must be **HTF/level-based**.
- **OB proximity** as an entry filter — inconclusive at 1m (too rare/small).
- **IPDA data ranges** — no edge (`ipda-edge`; distance artifact). Removed.

**The pattern:** every attempt to build a *positive* ICT entry trigger (sweep, OB
proximity, low-TF-FVG draw, IPDA level) failed to validate on SPX. The value that
*did* validate is **defensive / contextual**: knowing the HTF draw and warning
when a level entry is against it or mistimed (midday). That's the honest read —
ICT's *framework* (bias → draw → confluence) survives; its *mechanical low-TF
triggers* did not, on your sample.

---

## 12. Concept → Vantage engine map (quick index)

| ICT concept | `ict.py` function | Status |
|---|---|---|
| Swing highs/lows | `pivots()` | ✅ |
| Unswept BSL/SSL liquidity | `unswept_liquidity()` | ✅ |
| Order blocks (sweep+displacement+FVG) | `order_blocks()`, `active_obs()` | ✅ (context; edge inconclusive) |
| Fresh/unfilled FVGs | `fresh_fvgs()` | ✅ (filter, validated) |
| Breakers | in `order_blocks` port | ✅ |
| Draw on liquidity (level-based) | `draw_from_levels()` | ✅ (validated magnet) |
| ATR (displacement/reaction scale) | `atr()` | ✅ |
| IPDA data ranges | `ipda_ranges()` | ⚠️ backtest-only (no edge) |
| Premium/discount, OTE, SD projections, IRL/ERL, CE, mitigation/rejection blocks, volume imbalance, opening gaps, killzones/macros/Silver Bullet timing | — | not modeled (candidate adds; validate before wiring) |

---

*Sources: ICT (Michael J. Huddleston) mentorship/2022 model, Silver Bullet, Unicorn,
Turtle Soup, OTE, Judas/PO3 teachings; community formalizations flagged inline.
Vantage verdicts from `claudedocs/goals/ict-coach/` and `claudedocs/goals/ipda-edge/`.*
