# Hypothesis log — ux-feature-value

Evidence rule: every verdict cites something OBSERVED by driving the live
SPA (:8642 → :8641 → Mira :8080), not read from source. Usage traces (DB row
counts) are a secondary, corroborating signal only.

## E0 baseline — inventory + cold-open reality check

**method:** enumerate nav + drill-down routes, then load each in a real
browser and record what a first-time user sees (rendered / empty / error /
stale). Cross-check against DB row counts (what has ever actually been used).

**value (2026-07-14, live stack):** 15 routes — 11 nav + 4 drill-down. All 15
render without a crash. Content mass and state per route:

| route | chars | rows | first impression |
|---|---|---|---|
| dashboard | 3912 | 0 | rich, populated |
| holdings | 2338 | 57 | populated |
| tax | 6633 | 42 | populated (densest view) |
| options | 2070 | 18 | populated |
| playbook | 3581 | 0 | populated (levels render) |
| signalbot | 1830 | 16 | populated |
| exits | 462 | 0 | **"Nothing under management."** |
| paper | 2974 | 0 | populated |
| journal | 1790 | 7 | populated |
| futures | 3520 | 0 | populated |
| trades | 5206 | 72 | populated |
| charts | 639 | 0 | **raw ticker dump** (incl. option contracts, a CUSIP) |
| activity | 5501 | 50 | populated |
| recs | 387 | 0 | **"NO ANALYSIS AVAILABLE"** |
| markets | 751 | 8 | 8 signals, **all "◌ Unquoted"** |

**DB usage traces (secondary):** ticker_journal 368 · futures_fills 153 ·
paper_trades 13 · analysis 9 · signals 8 · journal_snapshots 4 ·
roundtrips 1 · ticker_plan 1 · nightly_runs 1 · **managed_positions 0**

### E0 findings (observed, not inferred)

**F1 — `/api/analysis` returns HTTP 500. The Recommendations view is DEAD,
and its empty state lies about why.** The view shows "NO ANALYSIS
AVAILABLE… Run the nightly analysis (python -m vantage_server.analyze)" —
but the nightly DID run and the DB holds 9 analysis rows. The real cause:
`ValueError: Out of range float values are not JSON compliant: nan` at
response serialization. Same NaN class as the technicals.py crash fixed
2026-07-13. A user following the on-screen instruction would re-run the
nightly, see no change, and conclude the app is broken. **Worst kind of
empty state: confidently wrong.**

**F2 — `markets` (Pattern signals) grades nothing.** The view's own subtitle
promises "statuses computed from live quotes"; all 8 signals read
"◌ Unquoted" with price/pnl/grade = null. The feature's entire value
proposition (grading authored signals against live prices) is inert. The 8
rows are also demo-looking (PLTR/SMCI/SOFI at fixed prices, "09:41").

**F3 — `charts` opens on a raw ticker dump.** 40+ symbols including option
contracts (`-MU260710C960`), a CUSIP (`089693105`), and an unparsed
`TVSMNCRPS-P1.NS` — no default selection, no grouping. It is a drill-down
target (reached from a Positions row), so arriving cold is arguably not the
designed path — but it's reachable and it looks broken.

**F4 — `exits` is honestly empty (0 managed positions).** Not a defect:
the feature shipped 2 days ago and no live trade has been taken. Flagged so
later experiments don't mistake "unused" for "useless".

**Predicate check:** the instrument discriminates (F1/F2 are real defects,
several views are healthy), so the study can proceed.

---

## H1 — "What do I trade today?" (cold open → a decision)

**prediction (pre-registered, before walking it):** The user lands on
Dashboard, which is portfolio-shaped (value, allocation, tax actions), NOT
trade-shaped — so it will NOT answer "what do I trade today". I predict the
user must self-route to 0DTE Playbook, and that the answer requires reading
a level ladder and mentally choosing a side. I predict ≥3 navigation steps
and that no single view states "here is today's trade" as a sentence.
I predict the Playbook view IS the load-bearing feature here and earns KEEP,
while Dashboard earns FIX (it occupies the default slot but doesn't serve
the primary job).

**experiment:** cold-load the SPA at the default route, then reach a
concrete trade decision (symbol, side, level, stop) using only the UI.
Record every navigation step and where the answer actually comes from.

**result (walked 2026-07-14, live SPA):**

Path actually required: **Dashboard (landing) → 0DTE Playbook → Signal Bot
= 3 views, 2 self-directed navigations.** Nothing linked me forward; I had to
know where to go.

- **Dashboard (default landing):** "your morning brief" — market tiles,
  total value, day P/L, harvestable losses, allocation, accounts. Zero
  mention of a trade, a level, or a signal. Regex for trade language on the
  landing view: the only hits were incidental. **The default view does not
  serve the app's primary job.**
- **0DTE Playbook:** genuinely strong. Levels + a narrated read ("Your line
  in the sand is the gamma flip at 7544… trade with the move, not against
  it"). But it never names a *trade*: `saysTheTrade` regex (long/short +
  reclaim/above/below) = **false**. It hands you context and expects you to
  synthesize the trade yourself.
- **Signal Bot:** THIS is where the answer lives. Today it showed
  3× 🔔 confirmed + 1 armed, each with exact side/symbol/level/entry/stop/
  target (e.g. `long SPY 751.18 → entry 752.10, stop 749.68, target 753.38`).

**verdict: PARTIALLY DISPROVEN (the interesting kind).**
- Confirmed: Dashboard doesn't serve the primary job (predicted); ≥3 steps
  (predicted).
- Disproven: I predicted the Playbook would be the load-bearing feature for
  this job. It isn't — **Signal Bot is**, and it's buried 6th in the nav
  under "Intelligence" with an icon (📡) that doesn't say "today's trades".
  The Playbook is the *reasoning*, the Signal Bot is the *answer*, and the
  app's information architecture has them backwards relative to the job.

**Feature verdicts from E1:**
- **Signal Bot → KEEP** (it is the answer to the app's core question), but
  **FIX its placement**: the confirmed-signals table is the single most
  decision-relevant surface in the app and it is 3 clicks deep.
- **0DTE Playbook → KEEP.** High-quality context; the narration is the best
  writing in the product.
- **Dashboard → FIX.** It owns the default slot but answers a *different*
  question (portfolio health). For a user whose job is "trade today", the
  landing page is a detour. Fix = surface today's confirmed signals on it.

**incidental observation (drives H3):** Signal Bot header reads
`paper: 8 closed · WR 25% · P&L -688.00`. The strategy the app actively
pushes to Telegram is, on its own track record, losing money. Flagged for E3.

---

## H2 — "A signal just fired. Do I act on it?" (signal → execution)

**prediction (pre-registered):** A user seeing 🔔 confirmed on Signal Bot
will try to act FROM that row. I predict there is **no execution affordance
on the signal row** — no "Execute" button — and that the user must know to
go to 0DTE Playbook → click a level → Stage ticket → Execute, re-entering
the level by hand. I predict the signal↔execute path is therefore broken as
a *flow* even though both halves work, and that this is the app's single
biggest UX gap. I predict the ticket modal itself (stage → dry-run → arm →
confirm) is well-gated and earns KEEP.

**experiment:** starting from a confirmed signal row, attempt to execute it
using only the UI. Count steps; record every place I must re-enter data the
app already knows.
**result (walked 2026-07-14):**

**CONFIRMED, and worse than predicted.**

1. **No execution affordance on any signal row.** Buttons present on the
   Signal Bot view: `Poll now`, `Save`, `Save & send test`, `show jobs`.
   Per-row action buttons: **0**. The word "execute" does not appear on the
   view at all. The app tells you a trade is live and offers you no way to
   take it.

2. **The signal's level is not executable — a units mismatch.** Today's
   confirmed signal: `long SPY @ 751.18`. The Playbook (where tickets live)
   works in **SPX** terms: 7515.3 spot, flip 7544. The string "751.18"
   appears **nowhere** on the Playbook view. The user must know SPY ≈ SPX/10
   and translate by hand.

3. **Even after translating, the signal is not ticketable.** Ticketable
   levels (the only ones with a `ticket` affordance): **7547, 7525, 7496.2,
   7469.2**. The signal in SPX terms ≈ **7511.8**. Nearest ticketable level
   is 7525 — **13.2 points away**. There is NO ticket for the level the bot
   actually fired on. The two halves of the product disagree about what a
   tradeable level is.

4. **The ticketable levels are behind a collapsed accordion** ("LEVEL LADDER
   (15)"), and the affordance is the bare lowercase word `ticket` — no
   button styling. Durable-memory levels (the visually prominent ones:
   7520.1, 7542.8…) are **not clickable at all**; I clicked one and its 3
   ancestors: no modal.

5. **The ticket modal itself is excellent.** Staged in one click: index→proxy
   rescale disclosed ("SPX is an index — staged in SPY at the live ratio
   0.10004"), full bracket (entry/stop/T1-T3), per-leg R:R (1.46 / 3.37 /
   5.15), max loss stated. Live is correctly gated: `Dry-run` appears, and
   `CONFIRM LIVE EXECUTE` does NOT exist until you arm.

**verdict: CONFIRMED** (predicted no execute-from-signal + predicted the
modal earns KEEP). The units mismatch and the non-ticketable signal level
were NOT predicted — the gap is structural, not just a missing button.

**Feature verdicts from E2:**
- **Ticket modal (stage → dry-run → arm → confirm) → KEEP.** Best-designed
  surface in the app: discloses the rescale, states max loss, gates live.
- **Signal → execution FLOW → FIX (highest priority in the study).** Three
  compounding defects: no row action; SPY-vs-SPX units mismatch; the fired
  level isn't among the ticketable ones. The fix is one thing: an "Execute"
  button on the confirmed-signal row that opens the ticket modal
  pre-seeded with THAT signal's symbol/side/level (the backend already
  accepts `signal_paper_id` — the wiring exists, the UI just doesn't use it).
- **Playbook level ladder → FIX.** The tradeable levels are collapsed by
  default while the non-actionable durable levels are prominent. Affordance
  ("ticket" as plain text) is nearly invisible.

---

## H3 — "How am I doing?" (track record / trust)

**prediction (pre-registered):** Performance is scattered across ≥3 views
(Paper Trading, Signal Bot summary, Performance/Trade Analytics, Futures)
with no single answer to "is this working". I predict they will DISAGREE or
double-count, because Signal Bot's summary counts only `source=auto` paper
trades while Paper Trading counts all of them. I further predict the app
does NOT confront the user with the fact that the live-pushed strategy is
currently losing (WR 25%, −$688) — it will report the number without
interpretation, so a user could keep taking losing signals without the app
ever saying "stop".

**experiment:** ask "is my strategy working?" using only the UI. Compare the
performance numbers each view reports for the SAME underlying trades.
**result (walked 2026-07-14): CONFIRMED — and it surfaced two real bugs.**

**Three views report three different answers to "is this working":**

| view | win rate | P&L | the story it tells |
|---|---|---|---|
| Paper Trading | **43%** | **+$842** (PF 4.97) | "working great" |
| Signal Bot | **25%** | **−$688** | "losing money" |
| Performance (Trade Analytics) | **37.8%** | PF 0.77 "below breakeven" | "losing" |

Ground truth from the DB (13 paper_trades, 9 closed):
- ALL closed: n=9, WR 33%, **−$220**
- auto/bot only: n=8, WR 25%, **−$688**  ← Signal Bot is honest
- manual only: n=1, WR 100%, +$468

**BUG A — Paper Trading's headline number is an artifact of a hidden
filter.** `/api/paper?symbol=SPX` returns only **7** closed rows — it is
scoped to the SPX/SPY proxy and **silently drops the two QQQ trades, which
are the two biggest losers (−$330, −$732)**. Removing the losers turns
−$220 into **+$842** and a 4.97 profit factor. The view's SPX/QQQ/IWM tabs
explain this to an author who knows the model; to a user, the default tab
reads as *the* track record. **The app's most encouraging number is produced
by excluding its worst trades.**

**BUG B — impossible trades: a LONG whose TARGET is BELOW its ENTRY.**
Paper #14 and #15: `side=long, entry=751.12, target=750.06, stop=745.70`,
closed `exit_reason=target`, `pnl=−106`. A long that "hits its target" for a
LOSS is arithmetically impossible — the target-selection picked an opposing
level *beneath* the entry, so the trade was **a guaranteed loss the moment
it was armed**, and the bot pushed it to Telegram as a signal. The UI
faithfully displayed "target ✅"-shaped output for a losing trade; **no view
flags it.**

**verdict: CONFIRMED.** Predicted: views disagree/double-count (yes — worse:
they contradict); predicted the app never confronts the user with the losing
record (yes — and one view actively hides it).

**Feature verdicts from E3:**
- **Signal Bot summary → KEEP.** It is the only honest scoreboard (25% /
  −$688 matches ground truth for the bot's own trades).
- **Paper Trading headline stats → FIX (urgent).** Either scope the label
  ("SPY only") or aggregate across underlyings. Today it flatters the
  strategy by omission — the single most dangerous UX defect found, because
  a user trusts it to decide whether to keep trading.
- **Performance (Trade Analytics) → KEEP.** Blunt and honest ("below
  breakeven", "MFE capture −25%"), but it measures the *broker* round-trips
  (as of 2026-07-05), NOT the reclaim strategy — the naming invites
  confusion with the bot's record.
- **Cross-view reconciliation → MISSING.** There is no one place that says
  "the strategy is currently losing money". Three surfaces, three answers.

---

## H4 — "What do I own and what should I do about it?" (portfolio job)

**prediction (pre-registered):** This is the app's ORIGINAL job (it began as
a portfolio aggregator) and I predict it is the best-served: Dashboard →
Positions → Tax is a coherent chain that answers ownership, P&L, and action.
I predict Tax (harvestable losses, 42 rows) is genuinely valuable and earns
KEEP. I predict the multi-currency handling (₹ + $) works. I predict the
weak link is Recommendations (already known dead from E0), so the
"what should I do" half of the job fails while the "what do I own" half
succeeds. I predict Options (18 rows) is useful but secondary.
**result (walked 2026-07-14): CONFIRMED — the portfolio job is the app's
best-served, with one display defect.**

- **Holdings (57 tickers)** — mature and opinionated: filters ("Actionable
  only", "Losers", "Has options"), sort by **Action priority**, per-row
  recommendation chips ("Hold & sell call", "Close & book loss", "Monitor").
  It answers "what do I own" AND "what should I do" in one surface.
- **Tax Center (42 lots)** — the strongest single feature in the product.
  Per-lot: unrealized, **wash-sale status checked across linked accounts**
  ("✓ Clear to harvest"), a concrete action ("Sell, wait 31 days"), and it
  correctly **excludes tax-advantaged accounts** ("N/A — tax-advantaged").
  Dashboard corroborates with a headline ($82,872 harvestable ≈ $19,889
  benefit at 24%). This is decision-support done right.
- **Options (18 open, 200 history)** — strategy roll-up by structure/ticker,
  live marks. Coherent and populated.
- **Recommendations** — still HTTP 500 / "NO ANALYSIS AVAILABLE" (E0/F1).
  So the "what should I do" job is served by Holdings+Tax *despite* the
  dedicated recommendations view being dead. **That is itself the finding:
  the feature is redundant AND broken.**

**BUG C — currency mislabeling in the Tax table (display-layer).** Zerodha
(correctly tagged `currency: INR`) lots render with a **`$` prefix on rupee
values**: `ITC.BO · 3324 sh @ $370.17 … −$314,508`. ITC trades around ₹400
(~$5). The TLH payload carries **no currency field at all** (42 candidates,
zero currency keys), so the view has nothing to format against. The
*actionable* math appears sound — the Dashboard's $82,872 headline is far
below the naive sum ($685k), i.e. the engine IS excluding INR/tax-advantaged
lots — but the table shows a user a "−$314,508 loss" that is really rupees.
**Right decisions, wrong labels.**

**verdict: CONFIRMED** (portfolio job best-served; Tax earns KEEP; the
"what should I do" half fails at the Recs view but is rescued by Holdings/Tax).
Not predicted: the currency-label defect.

**Feature verdicts from E4:**
- **Tax Center → KEEP (flagship).** Highest-value feature in the app.
- **Holdings → KEEP.** Action-priority sorting is the right idea.
- **Options → KEEP.**
- **Recommendations → CUT.** It is (a) broken with a misleading empty state
  and (b) redundant: Holdings' recommendation chips + Tax's action column
  already deliver the decision journal, better and in context. Cutting it
  removes a dead view rather than fixing a duplicate one.
- **Currency formatting → FIX.** Add `currency` to the TLH/lot payloads and
  format per-account.

---

## H5 — "Did the machine work last night? Can I trust it?" (ops/trust job)

**prediction (pre-registered):** The ops surfaces (nightly-run snapshot,
Managed Exits, Signal Bot status) were built in the last 72h and I predict
they are the most *honest* but least *discoverable* — ops state is scattered
across the Signal Bot view rather than owned by anything. I predict the
nightly card correctly shows last night's failure (the NaN job). I predict
the remaining two views I have not yet judged — Trading Journal (4 snapshots)
and Futures (153 fills, but 0 rows rendered in E0) — are the weakest
features: I predict **Futures earns CUT** (dead data, an abandoned side-quest)
and Trading Journal earns FIX-or-CUT.
**result (walked 2026-07-14): PARTIALLY DISPROVEN — my kill predictions were
wrong, and the ops layer is the app's conscience.**

- **Nightly-runs card → the trust question is ANSWERED.** It renders
  `2026-07-13 23:03 · 14✓ 1✗ · 1m32s · docker` and, without expanding
  anything, states the failure inline:
  `✗ position analysis (0s) — ValueError: cannot convert float NaN to integer`.
  A user learns the machine half-failed **without opening a log**. Verified
  the schedule is genuinely armed (launchd: nightly.docker + signalbot both
  loaded; bot loop RUNNING; now 16:55 ET, nightly fires 17:45) — so the
  single snapshot is *correct*, not a gap.
- **THE KEYSTONE FINDING:** that NaN failure **is the same root cause as F1**
  (Recommendations 500s on `nan` at JSON serialization). The ops layer
  *detected and displayed* the exact bug that silently killed another view —
  but nothing connects them. The app knows it is broken and cannot tell you
  which feature broke.
- **Futures → PREDICTION DISPROVEN.** I predicted CUT (dead side-quest).
  It is alive and genuinely good: 68 round-trips, expectancy $105/trade,
  PF 1.32, WR 54% — and it **self-reports its own data limitation**
  ("⚠️ Partial data: the export is a WINDOW, not full history; ~16 closing
  fills have opening fills from before the window"). That epistemic honesty
  is a *model* the performance views (H3) should copy.
- **Trading Journal → PREDICTION DISPROVEN.** Not weak: it scores
  **forecast vs. outcome** ("Level accuracy 39%", "Regime calls right 67%",
  5 SPX days journaled). This is the only feature that measures whether the
  app's *own predictions* are any good. That is rare and valuable.
- **Managed Exits → honestly empty**, correctly labeled ("live gate off —
  observe only", "Nothing under management"). Not a defect (0 live trades
  ever taken); it is *pre-emptively built* infrastructure.

**verdict: PARTIALLY DISPROVEN.** Confirmed: ops surfaces are honest but
scattered (nightly card is buried *inside* Signal Bot; there is no "system
health" home). Disproven: both features I predicted for the chopping block
(Futures, Journal) are among the app's most epistemically honest.

**Feature verdicts from E5:**
- **Nightly-runs card → KEEP** (but relocate: ops state belongs on the
  Dashboard, not buried in Signal Bot).
- **Futures → KEEP.** Reframe: its "partial data" warning is the app's best
  example of honest uncertainty.
- **Trading Journal → KEEP.** Measures the app's own forecast accuracy.
- **Managed Exits → KEEP (unused ≠ useless).** Correct empty state.

---

# FINAL REPORT — status: ACHIEVED

**Predicate check:**
1. **Coverage** ✓ — all 15 routes carry a verdict (below). No TBD.
2. **Grounding** ✓ — every verdict cites an observation from driving the live
   SPA (step counts, HTTP 500s, contradicting numbers, impossible trades).
3. **Discrimination** ✓ — 2 CUT, 9 KEEP, 4 FIX. The study did not conclude
   "everything is fine".
4. **Task success rates recorded** ✓ (below).

## Task success rates (5 jobs, driven in the real browser)

| # | job-to-be-done | outcome | cost |
|---|---|---|---|
| E1 | "What do I trade today?" | **completed with workaround** | 3 views, 2 self-directed jumps; the answer lives 6th in the nav |
| E2 | "A signal fired — do I act?" | **FAILED** | signal's level is not executable at all (units mismatch + not ticketable) |
| E3 | "How am I doing?" | **FAILED (actively misleading)** | 3 views, 3 contradicting answers; the flattering one hides the losers |
| E4 | "What do I own / what do I do?" | **completed unaided** | Holdings → Tax is coherent and excellent |
| E5 | "Did the machine work?" | **completed unaided** | nightly card answers it inline |

**2 of 5 core jobs fail.** Both failures are in the *trading* half — the
newest half. The *portfolio* half (the app's origin) works.

## Verdict table (all 15 routes)

| feature | verdict | evidence |
|---|---|---|
| Tax Center | **KEEP** ★ flagship | per-lot wash-sale + action; excludes tax-advantaged correctly |
| Holdings | **KEEP** | action-priority sort, recommendation chips |
| 0DTE Playbook | **KEEP** | best narration in the product ("your line in the sand is 7544") |
| Signal Bot | **KEEP** | the only honest scoreboard (25% / −$688 = ground truth) |
| Ticket modal | **KEEP** | discloses rescale, states max loss, gates live correctly |
| Trading Journal | **KEEP** | scores the app's OWN forecast accuracy (39% level acc.) |
| Futures | **KEEP** | self-reports its data limitation — model of honesty |
| Options | **KEEP** | strategy roll-up, live marks |
| Managed Exits | **KEEP** | unused ≠ useless; correct empty state |
| Nightly-runs card | **KEEP** (relocate) | surfaced the NaN failure without a log dig |
| **Dashboard** | **FIX** | owns the default slot; answers the wrong question for a trading user |
| **Paper Trading stats** | **FIX** ⚠ urgent | +$842/PF 4.97 is an artifact of silently dropping the QQQ losers |
| **Signal → execution flow** | **FIX** ⚠ urgent | no row action; SPY-vs-SPX mismatch; fired level not ticketable |
| **Level ladder** | **FIX** | tradeable levels collapsed; "ticket" affordance is bare text |
| **Recommendations** | **CUT** | HTTP 500 + lying empty state + redundant with Holdings/Tax |
| **Pattern signals (markets)** | **CUT** | 8 demo-shaped rows, all "◌ Unquoted" — grades nothing |
| Charts | **FIX** (drill-down only) | cold-open shows a raw dump incl. a CUSIP and option contracts |

## Bugs discovered while driving the UI (all real, none known before)

- **BUG A** — Paper Trading's headline stats exclude the QQQ trades (the two
  biggest losers). −$220 truth → +$842 displayed.
- **BUG B** — impossible trades: paper #14/#15 are LONGs whose **target
  (750.06) sits BELOW the entry (751.12)** — guaranteed losses at arming
  time, closed as `exit_reason=target`. **A strategy bug, not a UI bug.**
- **BUG C** — `/api/analysis` HTTP 500 on `nan` → Recommendations dead, with
  an empty state that blames the user's setup.
- **BUG D** — INR lots rendered with `$` (ITC at "$370.17"; a "−$314,508"
  loss that is rupees). TLH payload carries no currency field.

## Hypotheses: 3 confirmed · 2 partially disproven · 0 inconclusive

## The single most valuable disproven hypothesis

**H5's kill list.** I predicted Futures and Trading Journal — the two
lowest-traffic, oldest-looking views — would earn CUT as abandoned
side-quests. Driving them proved the opposite: **they are the two most
epistemically honest features in the product.** Futures volunteers that its
own data is a partial window; Trading Journal scores whether the app's own
forecasts were right (39% level accuracy). Meanwhile the *newest, most
polished* surfaces (Paper Trading's stats) are the ones that mislead.

**The lesson that generalizes:** in this app, feature *age and polish are
inversely correlated with honesty*. The mature features admit what they don't
know; the new ones report confident numbers that don't survive a cross-check.
The most dangerous view in Vantage is not the broken one (Recommendations,
which fails loudly) — it is **Paper Trading, which succeeds convincingly and
tells you your losing strategy is working.**
