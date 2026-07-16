"""The COACH indicator — a live discipline coach in Pine, generated from the
SPX playbook scaffold with its GEX + pivot levels BAKED IN.

This is the "before the fact" counterpart to the after-the-fact journal review.
The journal analysis found the operator's leaks are mechanical and checkable —
front-running the tag (95×), wrong side of the level (44×), extended entries,
adding to losers (17×). Those are exactly the conditions Pine CAN watch live.

WHAT IT DOES (honestly bounded):
  • Draws the baked GEX/pivot levels as lines, tinted by kind (call wall / put
    wall / flip = red-ish resistance-above / green support-below; the flip is
    the regime line).
  • Tracks SESSION VWAP (+σ bands), RSI, relative volume, ATR — live.
  • Emits a WAIT / ENTER / EXIT / WARN state each bar from a rule engine that
    encodes the playbook's discipline, NOT a price prediction:
      ENTER (green)  — price TAGGED a level and CLOSED back through it on the
                       correct side, with volume ≥ the session average. A clean,
                       confirmed reclaim/rejection at a real level.
      WAIT  (amber)  — price is NEAR a level but hasn't tagged/closed through it
                       (FRONT-RUN guard — a nudge to wait for the tag, not a
                       block: the backtest showed hard-blocking front-runs also
                       killed winners), or volume/VWAP don't confirm yet.
      WARN  (red)    — an unambiguous leak: wrong side of a wall, an extended
                       chase (far from VWAP + stretched RSI), or a knife into a
                       level. On 2026-07-15 these caught the −$1,650 wrong-side
                       call and the extended-chase puts with no false positives.
      EXIT  (blue)   — in-trade prompt: price reached the next level, or reverted
                       to VWAP after an extension — the "take it / it's done" cue.

WHAT IT CANNOT DO (same caveats as the GEX read): no live dealer-gamma feed —
the levels are last night's EOD estimate (which is exactly what framed a 0DTE
session); OI-based, blind to intraday 0DTE flow; not a buy/sell oracle. It flags
whether an entry breaks YOUR rules, not whether it will win.

Pure string assembly over the scaffold — no LLM, no I/O. Served as text by the
API for the UI to copy into TradingView (no .pine files, ADR-010).
"""
from __future__ import annotations

from . import reclaim_pine as _rp

#: Which baked level is a "wall" (hard resistance/support that a long should
#: not be bought ABOVE / a short sold BELOW) vs an ordinary shelf.
_WALL_KINDS = ("call wall", "put wall")
_FLIP_KINDS = ("flip", "gamma flip")


def _classify(label: str) -> str:
    """A baked level's role for the coach: 'callwall' | 'putwall' | 'flip' |
    'resistance' | 'support' | 'level'. Drives colour + the wrong-side rule."""
    l = (label or "").lower()
    if "call wall" in l:
        return "callwall"
    if "put wall" in l:
        return "putwall"
    if "flip" in l or "gamma" in l:
        return "flip"
    if "resist" in l:
        return "resistance"
    if "support" in l:
        return "support"
    return "level"


def build_coach_indicator(scaffold: dict, webhook_secret: str = "") -> str | None:
    """Render the coach Pine for a playbook ``scaffold``. None when the scaffold
    carries no levels to bake (nothing to coach against).

    ``webhook_secret`` is baked into the alert() payloads so the Vantage
    /webhook/tradingview endpoint can validate that an inbound alert really came
    from this indicator (TradingView can't send auth headers). Empty = alerts
    still fire but carry no secret (the endpoint will reject them if it has one
    configured)."""
    entries = _rp.gex_level_entries(scaffold)      # (price, label), high→low
    if not entries:
        return None

    reg = scaffold.get("regime") or {}
    session = str(scaffold.get("session") or "")
    gamma = str(reg.get("gamma") or "").lower()
    spot = reg.get("spot")

    # bake the levels as parallel Pine arrays: price, plain label, role
    prices, labels, roles = [], [], []
    for price, label in entries:
        prices.append(f"{float(price):.2f}")
        labels.append(_pine_str(_rp._clean_label(label)))
        roles.append(_pine_str(_classify(label)))
    px_arr = ", ".join(prices)
    lb_arr = ", ".join(labels)
    ro_arr = ", ".join(roles)

    # the flip (regime line) — the single most important level; find it if baked
    flip = next((float(p) for p, l in entries if _classify(l) == "flip"), None)
    flip_line = f"{flip:.2f}" if flip is not None else "na"

    header = (
        f"// VANTAGE COACH — generated for the {session} session.\n"
        f"// SPX regime: {gamma} gamma"
        + (f", spot ~{float(spot):.0f}" if spot is not None else "")
        + f". {reg.get('vwap_regime') or ''}\n"
        "// A PLAN-EXECUTION coach. It ARMS the nearest forecast setup, waits for\n"
        "// the reclaim TRIGGER, then walks the trade: HOLD toward target, SCALE\n"
        "// OUT if the target comes at risk, or STOP. On an SPX chart it plans off\n"
        "// the baked GEX/pivot levels (auto-detected); on any other symbol it\n"
        "// plans off swing structure. EOD levels, 0DTE-blind. Not financial\n"
        "// advice. Add to an intraday chart.\n"
    )

    # the secret is a plain token embedded in the alert JSON — escape any quote
    secret = str(webhook_secret or "").replace('"', "").replace("\\", "")
    # Inject via .replace(), NOT .format(): the body's alertcondition messages
    # contain TradingView placeholders ({{ticker}}, {{plot("Entry")}}) and JSON
    # braces that .format() would mangle. .replace() leaves those untouched.
    body = _COACH_BODY
    for key, val in (
        ("{px_arr}", px_arr), ("{lb_arr}", lb_arr), ("{ro_arr}", ro_arr),
        ("{flip_line}", flip_line), ("{n_levels}", str(len(prices))),
        ("{webhook_secret}", secret), ("{gex_date}", session or "?"),
    ):
        body = body.replace(key, val)
    return header + body


def _pine_str(s: str) -> str:
    """A double-quoted Pine string literal, quotes escaped."""
    return '"' + str(s or "").replace('"', "'") + '"'


# The coach body. Placeholders: {px_arr} {lb_arr} {ro_arr} {flip_line}
# {n_levels}. Written as a raw Pine v5 indicator; all the discipline logic lives
# here so the generator stays a pure level-baker.
_COACH_BODY = '''//@version=5
indicator("Vantage Coach", overlay=true, max_lines_count=200, max_labels_count=200)

// ── baked SPX playbook levels (GEX walls + S/R + fib + volume confluence) ────
// These are SPX-specific. They're used ONLY when the chart IS SPX (auto-gated
// below via syminfo). On any other symbol the coach arms trades off swing
// structure instead, so the same indicator works on any ticker.
var float[] gexPx  = array.from({px_arr})
var string[] gexLb = array.from({lb_arr})
var string[] gexRo = array.from({ro_arr})
float gexFlip = {flip_line}
gexDate = "{gex_date}"   // the session these GEX levels were generated for

// ── inputs ───────────────────────────────────────────────────────────────────
reclaimN = input.int(2, "Reclaim = this many closes back through the level", minval=1, maxval=5, group="Plan", tooltip="The TRIGGER. A long arms at a support/put-wall/flip; it fires only after this many consecutive closes back ABOVE it (reclaim, not just a touch). Shorts mirror at resistance/call-wall.")
stopPad  = input.float(0.06, "Stop pad (% beyond the trigger level)", minval=0.0, step=0.02, group="Plan", tooltip="Stop sits this far beyond the trigger level. 0.06% ~= 4.5pt at SPX 7500.")
armDist  = input.float(0.20, "Arm when price within this % of a level", minval=0.05, step=0.05, group="Plan", tooltip="How close price must get to a level before the coach ARMS that setup and starts watching for the trigger.")
rrMin    = input.float(1.5, "Min reward:risk to fire", minval=0.0, step=0.1, group="Plan", tooltip="A setup only TRIGGERS if the target (next opposing level) sits beyond the entry AND reward:risk from the entry is at least this. Backtest-validated: this is the fix for the wrong-side-target + low-R:R losers that sank the live paper trades (24% WR).")
tagTol   = input.float(0.05, "Tag tolerance (% of price)", minval=0.01, maxval=0.5, step=0.01, group="Coach", tooltip="How close counts as 'at' a level.")
volLen   = input.int(20, "Rel-volume lookback (bars)", minval=5, group="Coach")
rsiLen   = input.int(14, "RSI length", minval=2, group="Coach")
swingLen = input.int(10, "Swing lookback (non-SPX arming)", minval=3, group="Coach", tooltip="On non-SPX charts the coach arms off the most recent swing high/low over this many bars (a reclaim of a swing = trigger).")
stallBars= input.int(10, "Stall window (bars)", minval=3, group="Coach", tooltip="How many bars of tight range = a coil. On 1m that's ~10 min of price stuck at a level.")
stallMax = input.float(3.0, "Stall = range under this many ATR", minval=0.5, step=0.5, group="Coach", tooltip="If the last N-bar range is under this many ATR, price is coiled. A 0DTE long bleeds theta while it waits for the break.")
showLines= input.bool(true, "Draw the levels", group="Display")
showVwap = input.bool(true, "Draw session VWAP + bands", group="Display")
showPanel= input.bool(true, "Show the coach panel (bottom-right)", group="Display")

// ── SPX gate: is THIS chart SPX (so the baked GEX levels apply)? ──────────────
// Auto-detected from the symbol. On SPX/SPXW/SPY/ES the coach plans off the
// baked GEX levels; elsewhere it plans off swing structure.
_tk = str.upper(syminfo.ticker)
isSpx = str.contains(_tk, "SPX") or str.contains(_tk, "US500") or str.contains(_tk, "SPX500") or str.contains(_tk, "SP500") or _tk == "SPY" or str.contains(_tk, "ES1!") or str.startswith(_tk, "ES") or str.contains(str.upper(syminfo.root), "ES")

// ── session VWAP + bands, RSI, relative volume, ATR ──────────────────────────
newSession = ta.change(time("D")) != 0
var float sumPV = na
var float sumV  = na
var float sumP2V= na
src = hlc3
if newSession or na(sumV)
    sumPV := src * volume
    sumV  := volume
    sumP2V:= src * src * volume
else
    sumPV += src * volume
    sumV  += volume
    sumP2V+= src * src * volume
vwap = sumV > 0 ? sumPV / sumV : na
variance = sumV > 0 ? math.max(sumP2V / sumV - vwap * vwap, 0) : 0
vsd = math.sqrt(variance)
vwUp = vwap + vsd
vwDn = vwap - vsd

rsi   = ta.rsi(close, rsiLen)
atr   = ta.atr(14)
avgV  = ta.sma(volume, volLen)
relV  = avgV > 0 ? volume / avgV : na
volOK = na(relV) ? false : relV >= 1.0          // participation >= session average

// ── the PLAN's levels: baked GEX on SPX, swing structure elsewhere ───────────
// When the chart is SPX we plan off the baked GEX ladder. Otherwise we build a
// tiny 2-level ladder from the most recent swing high & low — so the coach can
// arm a trade on ANY ticker (reclaim of a swing = the same kind of trigger).
swHi = ta.pivothigh(high, swingLen, swingLen)
swLo = ta.pivotlow(low, swingLen, swingLen)
var float lastSwHi = na
var float lastSwLo = na
lastSwHi := not na(swHi) ? swHi : lastSwHi
lastSwLo := not na(swLo) ? swLo : lastSwLo

// working ladder (price, label, role) — either the GEX arrays or the swings.
useGex = isSpx and array.size(gexPx) > 0

// nearest support-ish (below/at price) and resistance-ish (above/at price)
var float supPx = na
var string supLb = na
var float resPx = na
var string resLb = na
supPx := na
supLb := na
resPx := na
resLb := na
if useGex
    bestSup = 1e9
    bestRes = 1e9
    for i = 0 to array.size(gexPx) - 1
        p = array.get(gexPx, i)
        ro = array.get(gexRo, i)
        lb = array.get(gexLb, i)
        // Arm off the S/R-tagged levels only. Backtested (coach-edge H4): making
        // EVERY level tradeable by position (incl. bare volume-PoC / fib) cut
        // WR 0.73 → 0.37 / PF 6.9 → 1.15 — the support/resistance-tagged levels
        // are materially better entries. Bare confluence levels still draw and
        // still serve as TARGETS; they just don't arm an entry.
        longable  = ro == "support" or ro == "putwall" or ro == "flip"
        shortable = ro == "resistance" or ro == "callwall" or ro == "flip"
        if p <= close and longable and (close - p) < bestSup
            bestSup := close - p
            supPx := p
            supLb := lb
        if p >= close and shortable and (p - close) < bestRes
            bestRes := p - close
            resPx := p
            resLb := lb
else
    if not na(lastSwLo)
        supPx := lastSwLo
        supLb := "swing low"
    if not na(lastSwHi)
        resPx := lastSwHi
        resLb := "swing high"

// distance from VWAP in ATR — the "extended / chasing" gauge
vwGap = na(vwap) or na(atr) or atr == 0 ? na : (close - vwap) / atr
aboveFlip = na(gexFlip) or close >= gexFlip

// ── STALL gauge: is price COILED (theta-bleed risk for a 0DTE long) ──────────
stallRange = ta.highest(high, stallBars) - ta.lowest(low, stallBars)
stallRatio = na(atr) or atr == 0 ? na : stallRange / atr
coiled = not na(stallRatio) and stallRatio <= stallMax
var int coilBars = 0
coilBars := coiled ? coilBars + 1 : 0
nyHour = hour(time, "America/New_York")
nyMin  = minute(time, "America/New_York")
mins   = nyHour * 60 + nyMin
midday = mins >= 11*60+30 and mins < 14*60

// ═══════════════════════════════════════════════════════════════════════════
// THE PLAN-EXECUTION STATE MACHINE
//   ARMED  → a setup is loaded at the nearest level; watching for the trigger
//   IN     → the reclaim fired; walk the trade toward T1, or SCALE / STOP
// ═══════════════════════════════════════════════════════════════════════════
// BOTH sides can be armed at once: a LONG at the support below, a SHORT at the
// resistance above. Whichever TRIGGERS first is the trade. (This is why shorts
// were never firing before — the old code armed only the nearer of the two.)
distSup = na(supPx) ? 1e9 : math.abs(close - supPx)
distRes = na(resPx) ? 1e9 : math.abs(close - resPx)
armTol  = close * armDist / 100.0
armLong  = not na(supPx) and distSup <= armTol      // near a support → watch for a reclaim (long)
armShort = not na(resPx) and distRes <= armTol      // near a resistance → watch for a rejection (short)

// the TRIGGER: `reclaimN` closes back through the level (long above sup, short below res)
closesAboveSup = armLong  ? (ta.barssince(close <= supPx) >= reclaimN) : false
closesBelowRes = armShort ? (ta.barssince(close >= resPx) >= reclaimN) : false
rawTrigLong  = armLong  and closesAboveSup and close > supPx
rawTrigShort = armShort and closesBelowRes and close < resPx

// ── R:R GATE (backtest-validated, coach-edge goal) ───────────────────────────
// Entry is the reclaim CLOSE (where it fires), not the level. Two guards a
// trade must clear or it does NOT fire — the exact bugs that sank the live
// paper trades (24% WR): (1) the target must sit STRICTLY BEYOND the entry
// (a resistance that's already below a long's fill = instant loss); (2) R:R
// from the entry must be >= rrMin. On the frozen window these lift the coach's
// rules to WR 0.73 / PF 6.9 with zero wrong-side-target losses.
padGate   = close * stopPad / 100.0
longStopG = supPx - padGate
shrtStopG = resPx + padGate
longRiskG = close - longStopG
shrtRiskG = shrtStopG - close
// target = the OPPOSING level, only if it's genuinely beyond the entry close
longTgtOk = rawTrigLong  and not na(resPx) and resPx > close and longRiskG > 0 and (resPx - close) / longRiskG >= rrMin
shrtTgtOk = rawTrigShort and not na(supPx) and supPx < close and shrtRiskG > 0 and (close - supPx) / shrtRiskG >= rrMin
triggerLong  = rawTrigLong  and longTgtOk
triggerShort = rawTrigShort and shrtTgtOk

// which setup does the PANEL describe? the one closer to triggering (long if it
// just fired, else the nearer armed side). entry/stop/target follow from it.
pad = close * stopPad / 100.0
showLong = triggerLong or (armLong and (not armShort or distSup <= distRes))
armLevel = showLong ? supPx : armShort ? resPx : na
armLbl   = showLong ? supLb : armShort ? resLb : na
armEntry = armLevel
armStop  = showLong and not na(armLevel) ? armLevel - pad : armShort and not na(armLevel) ? armLevel + pad : na
armT1    = showLong ? resPx : armShort ? supPx : na
armRR    = (na(armEntry) or na(armStop) or na(armT1) or math.abs(armEntry - armStop) == 0) ? na : math.abs(armT1 - armEntry) / math.abs(armEntry - armStop)

// ── the live trade (Pine can't see your fills; it tracks the coach's plan) ───
var int   tDir   = 0        // +1 long, -1 short, 0 flat
var float tEntry = na
var float tStop  = na
var float tT1    = na
var float tPeak  = na       // best favorable excursion — powers the scale-out call
var string tOutcome = na
firedNow = false            // did a trigger fire on THIS bar?

// fire a new trade on a trigger (only when flat). Entry = the reclaim close;
// stop = pad beyond the reclaimed level; T1 = the validated opposing target.
if tDir == 0 and (triggerLong or triggerShort)
    tDir := triggerLong ? 1 : -1
    tEntry := close
    tStop := triggerLong ? longStopG : shrtStopG
    tT1 := triggerLong ? resPx : supPx
    tPeak := close
    tOutcome := na
    firedNow := true

inTrade = tDir != 0
pnlPts  = not inTrade or na(tEntry) ? na : (close - tEntry) * tDir
if inTrade
    tPeak := tDir == 1 ? math.max(tPeak, high) : math.min(tPeak, low)
peakPts = not inTrade or na(tPeak) or na(tEntry) ? na : (tPeak - tEntry) * tDir   // max favorable, pts

// resolve: stop or target hit ends the trade
stopHit = inTrade and not na(tStop) and (tDir == 1 ? low <= tStop : high >= tStop)
tgtHit  = inTrade and not na(tT1) and (tDir == 1 ? high >= tT1 : low <= tT1)
if inTrade and (stopHit or tgtHit)
    tOutcome := stopHit ? "STOPPED" : "TARGET HIT"
    tDir := 0

// ── SCALE-OUT logic: is the full target at risk, with green on the table? ────
// We advise a partial when we're IN a trade, in profit, gave back a chunk of
// the peak (momentum fading) OR lost VWAP OR coiled — and T1 isn't reached yet.
gaveBack   = inTrade and not na(peakPts) and peakPts > 0 and not na(pnlPts) and (peakPts - pnlPts) >= (peakPts * 0.5) and peakPts >= (na(atr) ? 0 : atr)
lostVwap   = inTrade and not na(vwap) and (tDir == 1 ? (close < vwap and close[1] >= vwap) : (close > vwap and close[1] <= vwap))
stalledIn  = inTrade and coiled and coilBars >= stallBars
inProfit   = inTrade and not na(pnlPts) and pnlPts > 0
scaleOut   = inProfit and not tgtHit and (gaveBack or lostVwap or stalledIn)
// a sensible interim place to trim: VWAP if it's ahead of us, else the peak
vwapAhead = not na(vwap) and (tDir == 1 ? (vwap > tEntry and vwap < tT1) : (vwap < tEntry and vwap > tT1))
scaleAt = vwapAhead ? vwap : tPeak

// theta bleed while ARMED-but-not-triggered (0DTE long waiting on a coil)
thetaWait = not inTrade and armLong and coiled and coilBars >= stallBars

// ── resolve ONE coach STATE for the plan lifecycle ───────────────────────────
state = firedNow ? "TRIGGERED" : (inTrade and scaleOut) ? "SCALE" : inTrade ? "HOLD" : (armLong or armShort) ? (thetaWait ? "THETA" : "ARMED") : "WAIT"

// ── the ACTION banner verb — the ONE thing to read ───────────────────────────
action = state == "TRIGGERED" ? (tDir == 1 ? "🔔 BUY CALLS NOW" : "🔔 BUY PUTS NOW") : state == "SCALE" ? "SCALE OUT — TAKE PARTIAL" : state == "HOLD" ? (pnlPts >= 0 ? "HOLD TOWARD TARGET" : "HOLD — STOP INTACT") : state == "ARMED" ? (showLong ? "ARMED · LONG " + armLbl : "ARMED · SHORT " + armLbl) : state == "THETA" ? "WAITING — THETA RISK" : "STAND ASIDE"

// ═══ TECHNICALS READ — synthesize RSI + Volume + Headroom into ONE verdict ═══
// Answers "is the target likely, or does it reverse?" instead of showing three
// raw gauges. Heuristic (not backtested like the entry engine) → shown with a
// one-line caveat. The DIRECTION for the read is the live trade, else the armed
// setup, else long-bias for a WAIT.
rdDir = inTrade ? tDir : showLong ? 1 : armShort ? -1 : 1

// RSI divergence: over the last `divLen` bars did price make a new extreme in
// the trade direction WITHOUT RSI confirming? (price up, RSI not = tiring.)
divLen = 5
pricePush = rdDir == 1 ? (close >= ta.highest(close, divLen)) : (close <= ta.lowest(close, divLen))
rsiPush   = rdDir == 1 ? (rsi   >= ta.highest(rsi, divLen))   : (rsi   <= ta.lowest(rsi, divLen))
rsiDiverging = pricePush and not rsiPush            // price extended, momentum didn't follow
rsiConfirming = pricePush and rsiPush

// Volume read: surging / steady / fading vs the session-average baseline.
volSurge = not na(relV) and relV >= 1.3
volFade  = not na(relV) and relV < 0.8

// Headroom to target in ATR (internal — shown to the user in POINTS, not ATR).
hdPx  = inTrade ? tT1 : armT1
hdPts = na(hdPx) ? na : math.abs(hdPx - close)
hdAtr = na(hdPts) or na(atr) or atr == 0 ? na : hdPts / atr
roomTight = not na(hdAtr) and hdAtr <= 1.0        // almost there
roomFar   = not na(hdAtr) and hdAtr >= 3.0        // a long way to go

// the VERDICT — priority: clearly-fading beats clearly-fueled beats neutral.
// STALLING / DOUBTFUL fire when momentum is gone; the difference is how much
// room is left (far + dead = stalling; near + dead = doubtful it finishes).
fueled = volSurge and (rsiConfirming or not rsiDiverging)
dead   = (volFade or rsiDiverging)
readCode = (state == "WAIT" or na(hdPx)) ? "none" : (fueled and not rsiDiverging) ? "fuel" : (dead and roomFar) ? "stall" : dead ? "doubt" : "reach"

readVerd = readCode == "fuel" ? "MOMENTUM BEHIND IT" : readCode == "reach" ? "TARGET IN REACH" : readCode == "doubt" ? "TARGET DOUBTFUL" : readCode == "stall" ? "STALLING" : "NO EDGE YET"
readTone = (readCode == "fuel" or readCode == "reach") ? "good" : (readCode == "doubt" or readCode == "stall") ? "bad" : "warn"
readTxt  = readCode == "fuel" ? "volume surged and RSI's rising with price — fuel to reach " + str.tostring(hdPx, "#.#") : readCode == "reach" ? "tape still confirming, room left — on track for " + str.tostring(hdPx, "#.#") : readCode == "doubt" ? "push is tiring with " + str.tostring(hdPts, "#") + "pt still to go — lean to bank some" : readCode == "stall" ? "volume dead and RSI rolled over, target " + str.tostring(hdPts, "#") + "pt off — more likely to reverse" : "no clear edge — wait for volume to confirm"

// ═══ PANEL CONTENT — an adaptive trade TICKET (label | value grid) ══════════
// distances to manage a live trade
toT1   = inTrade and not na(tT1) ? math.abs(tT1 - close) : na
toStop = inTrade and not na(tStop) ? math.abs(close - tStop) : na

// the four grid rows are (label, value) pairs that CHANGE by state. Slots stay
// in the same place; only what fills them adapts.
//   ARMED/TRIGGERED → the plan: Entry · Trigger · Target · Stop (+R:R banner)
//   HOLD            → the live trade: Entry · P&L · To target · To stop
//   SCALE           → HOLD rows but the action says trim
r1L = inTrade ? "Entry"   : "Entry"
r1V = inTrade ? str.tostring(tEntry, "#.#") : (na(armLevel) ? "—" : str.tostring(armLevel, "#.#"))
r2L = inTrade ? "P&L"     : "Trigger"
r2V = inTrade ? (str.tostring(pnlPts, "+#.#;-#.#") + "pt " + (na(pnlPts) ? "" : (pnlPts >= 0 ? "🟢" : "🔴"))) : (na(armLevel) ? "—" : str.tostring(reclaimN) + "× " + (showLong ? "above" : "below"))
r3L = inTrade ? "To target" : "Target"
r3V = inTrade ? (na(toT1) ? "open" : str.tostring(toT1, "#.#") + "pt → " + str.tostring(tT1, "#.#")) : (na(armT1) ? "open" : str.tostring(armT1, "#.#"))
r4L = inTrade ? "To stop"  : "Stop"
r4V = inTrade ? (na(toStop) ? "—" : str.tostring(toStop, "#.#") + "pt → " + str.tostring(tStop, "#.#")) : (na(armStop) ? "—" : str.tostring(armStop, "#.#"))
rrV = na(armRR) ? "" : "R:R " + str.tostring(armRR, "#.#")

// ONE plain-English coaching line — "what to do right now"
coachLine = state == "TRIGGERED" ? "enter now — target " + str.tostring(tT1, "#.#") + ", stop " + str.tostring(tStop, "#.#") : state == "SCALE" ? "momentum fading — trim near " + str.tostring(scaleAt, "#.#") + ", let the rest run" : state == "HOLD" ? (pnlPts >= 0 ? "in the plan — hold toward " + str.tostring(tT1, "#.#") : "red but stop holds — don't fold") : state == "ARMED" ? "wait for " + str.tostring(reclaimN) + " closes " + (showLong ? "above " : "below ") + str.tostring(armLevel, "#.#") + " — then enter" : state == "THETA" ? "coiled " + str.tostring(coilBars) + " bars — theta bleeding, wait for the break" : "no setup in range — stand aside"

// TECHNICALS numbers (shown raw above the READ). VWAP dropped — it's on chart.
rsiNum = str.tostring(rsi, "#") + (rsiDiverging ? " ↓div" : "")
volNum = na(relV) ? "—" : str.tostring(relV, "#.#") + "×"
hdNum  = na(hdPts) ? "—" : str.tostring(hdPts, "#") + "pt"

// ── plots ─────────────────────────────────────────────────────────────────────
plot(showVwap ? vwap : na, "VWAP", color=color.new(#2f6df6, 0), linewidth=2)
plot(showVwap ? vwUp : na, "VWAP +σ", color=color.new(#2f6df6, 70), style=plot.style_line)
plot(showVwap ? vwDn : na, "VWAP -σ", color=color.new(#2f6df6, 70), style=plot.style_line)

// HIDDEN value plots — so an alertcondition message can pull the live plan via
// {{plot("Entry")}} etc. (TradingView free plan can't use alert(); alertcondition
// messages only reach values that are PLOTTED). display=none keeps them off the
// chart; they still resolve in alert placeholders.
plotEntry  = inTrade ? tEntry : armLevel
plotTarget = inTrade ? tT1 : armT1
plotStop   = inTrade ? tStop : armStop
plot(plotEntry,  "Entry",  display=display.none)
plot(plotTarget, "Target", display=display.none)
plot(plotStop,   "Stop",   display=display.none)
plot(armRR,      "RR",     display=display.none)

// draw the baked GEX levels — ONLY on SPX (auto-gated). Lines span the whole
// session and their LABELS ride the right edge (redrawn each bar) so they're
// always readable next to price, not stranded off-screen.
var line[] gexLines = array.new_line()
var label[] gexLabels = array.new_label()
if showLines and useGex and barstate.islast
    if array.size(gexLines) > 0
        for i = 0 to array.size(gexLines) - 1
            line.delete(array.get(gexLines, i))
            label.delete(array.get(gexLabels, i))
        array.clear(gexLines)
        array.clear(gexLabels)
    for i = 0 to array.size(gexPx) - 1
        p  = array.get(gexPx, i)
        ro = array.get(gexRo, i)
        isRes = ro == "callwall" or ro == "resistance"
        isSup = ro == "putwall" or ro == "support"
        col = isRes ? color.new(#cf3b47, 25) : isSup ? color.new(#16915b, 25) : color.new(#e0a020, 15)
        wide = ro == "callwall" or ro == "putwall" or ro == "flip"
        array.push(gexLines, line.new(bar_index - 300, p, bar_index, p, xloc=xloc.bar_index, extend=extend.right, color=col, width=wide ? 2 : 1))
        array.push(gexLabels, label.new(bar_index, p, array.get(gexLb, i) + " " + str.tostring(p, "#.#"), xloc=xloc.bar_index, style=label.style_label_left, textcolor=color.white, color=color.new(isRes ? #cf3b47 : isSup ? #16915b : #b26a00, 15), size=size.small))

// TRADE / PLAN lines on the chart: entry · stop · target.
// While IN a trade they're solid; while ARMED they're drawn FAINT + dotted so
// you can SEE the pending plan (which level is armed, where T1/stop sit) before
// it triggers — answering "which line is the setup?" on the chart, not just the
// panel. Redrawn on the last bar so they ride the right edge.
var line lnEntry = na
var line lnStop = na
var line lnT1 = na
var label lnTag = na
armedShow = (state == "ARMED" or state == "THETA") and not na(armLevel)
if barstate.islast
    line.delete(lnEntry)
    line.delete(lnStop)
    line.delete(lnT1)
    label.delete(lnTag)
    lnEntry := na
    lnStop := na
    lnT1 := na
    lnTag := na
    if inTrade
        lnEntry := line.new(bar_index - 30, tEntry, bar_index, tEntry, extend=extend.right, color=color.new(#e8eaed, 0), width=2)
        lnStop  := line.new(bar_index - 30, tStop, bar_index, tStop, extend=extend.right, color=color.new(#EF5350, 0), style=line.style_dashed)
        lnT1    := na(tT1) ? na : line.new(bar_index - 30, tT1, bar_index, tT1, extend=extend.right, color=color.new(#26A69A, 0), style=line.style_dashed)
        lnTag   := label.new(bar_index, tEntry, (tDir == 1 ? "LONG " : "SHORT ") + str.tostring(tEntry, "#.#"), style=label.style_label_left, color=color.new(#e8eaed, 0), textcolor=color.black, size=size.small)
    else if armedShow
        lnEntry := line.new(bar_index - 30, armLevel, bar_index, armLevel, extend=extend.right, color=color.new(#7c5cff, 0), width=2)
        lnStop  := na(armStop) ? na : line.new(bar_index - 30, armStop, bar_index, armStop, extend=extend.right, color=color.new(#EF5350, 40), style=line.style_dotted)
        lnT1    := na(armT1) ? na : line.new(bar_index - 30, armT1, bar_index, armT1, extend=extend.right, color=color.new(#26A69A, 40), style=line.style_dotted)
        lnTag   := label.new(bar_index, armLevel, "ARMED " + (showLong ? "LONG " : "SHORT ") + str.tostring(armLevel, "#.#"), style=label.style_label_left, color=color.new(#7c5cff, 0), textcolor=color.white, size=size.small)

// on-chart markers — small, and ONLY at the moments that matter: the entry
// trigger, and the exit (target or stop). No background shading, no SCALE spam
// (SCALE lives in the panel; flagging every qualifying bar clutters the chart).
stateChanged = state != state[1]
firstScale = state == "SCALE" and state[1] != "SCALE"   // only the FIRST scale bar
plotshape(firedNow and tDir == 1, title="Long trigger", location=location.belowbar, style=shape.triangleup, color=color.new(#16915b,0), size=size.tiny, text="LONG")
plotshape(firedNow and tDir == -1, title="Short trigger", location=location.abovebar, style=shape.triangledown, color=color.new(#cf3b47,0), size=size.tiny, text="SHORT")
plotshape(firstScale, title="Scale", location=location.abovebar, style=shape.flag, color=color.new(#e0a020,0), size=size.tiny)
plotshape(tOutcome == "TARGET HIT" and tOutcome[1] != "TARGET HIT", title="Target", location=location.abovebar, style=shape.diamond, color=color.new(#26A69A,0), size=size.tiny)
plotshape(tOutcome == "STOPPED" and tOutcome[1] != "STOPPED", title="Stop", location=location.abovebar, style=shape.xcross, color=color.new(#EF5350,0), size=size.tiny)

// ── the coach panel (BOTTOM-RIGHT) — an adaptive trade TICKET ─────────────────
// Banner (state + direction) → adaptive label|value grid → coaching line →
// TECHNICALS (RSI/Vol/Headroom numbers + a synthesized READ) → caveat.
// Bold, white-on-dark, one font, so it holds up over candles on the grey chart.
var table panel = table.new(position.bottom_right, 2, 10, border_width=1, frame_width=1, frame_color=color.new(#333c48, 0))
if showPanel and barstate.islast
    stCol = state == "TRIGGERED" ? #16915b : state == "SCALE" ? #e0a020 : state == "HOLD" ? #2f6df6 : state == "ARMED" ? #7c5cff : state == "THETA" ? #e0a020 : #4a5563
    dark = color.new(#0d1017, 0)
    row = color.new(#161b23, 0)
    rowA = color.new(#1b212b, 0)
    lblc = color.new(#aeb7c4, 0)
    valc = color.new(#ffffff, 0)
    grnC = color.new(#39d98a, 0)
    redC = color.new(#ff6b74, 0)
    // ROW 0 — state banner + direction, spanning both columns
    dirTag = inTrade ? (tDir == 1 ? "LONG · " : "SHORT · ") : (state == "ARMED" or state == "THETA") ? (showLong ? "LONG · " : "SHORT · ") : ""
    bannerTxt = dirTag + action + (rrV == "" or inTrade ? "" : "   ·   " + rrV)
    table.cell(panel, 0, 0, bannerTxt, text_color=color.white, bgcolor=color.new(stCol, 0), text_size=size.normal, text_halign=text.align_center)
    table.merge_cells(panel, 0, 0, 1, 0)
    // ROWS 1-4 — the adaptive label|value grid (bolder: normal, not small)
    table.cell(panel, 0, 1, r1L, text_color=lblc, bgcolor=dark, text_size=size.normal, text_halign=text.align_left)
    table.cell(panel, 1, 1, r1V, text_color=valc, bgcolor=dark, text_size=size.normal, text_halign=text.align_right)
    table.cell(panel, 0, 2, r2L, text_color=lblc, bgcolor=row, text_size=size.normal, text_halign=text.align_left)
    table.cell(panel, 1, 2, r2V, text_color=(inTrade and not na(pnlPts) and pnlPts < 0) ? redC : (inTrade and not na(pnlPts)) ? grnC : valc, bgcolor=row, text_size=size.normal, text_halign=text.align_right)
    table.cell(panel, 0, 3, r3L, text_color=lblc, bgcolor=dark, text_size=size.normal, text_halign=text.align_left)
    table.cell(panel, 1, 3, r3V, text_color=grnC, bgcolor=dark, text_size=size.normal, text_halign=text.align_right)
    table.cell(panel, 0, 4, r4L, text_color=lblc, bgcolor=row, text_size=size.normal, text_halign=text.align_left)
    table.cell(panel, 1, 4, r4V, text_color=redC, bgcolor=row, text_size=size.normal, text_halign=text.align_right)
    // ROW 5 — the coaching line (spans both cols)
    table.cell(panel, 0, 5, coachLine, text_color=color.white, bgcolor=color.new(#20262f, 0), text_size=size.normal, text_halign=text.align_left)
    table.merge_cells(panel, 0, 5, 1, 5)
    // ROW 6 — TECHNICALS numbers: RSI · Vol · Headroom (spans both cols)
    techNums = "RSI " + rsiNum + "   ·   VOL " + volNum + "   ·   " + hdNum + " to T1"
    table.cell(panel, 0, 6, techNums, text_color=lblc, bgcolor=dark, text_size=size.small, text_halign=text.align_center)
    table.merge_cells(panel, 0, 6, 1, 6)
    // ROW 7 — the READ verdict (its own colored cell) + ROW 8 the read sentence
    readCol = readTone == "good" ? #145c3a : readTone == "bad" ? #6e2530 : #5a4410
    readTxtC = readTone == "good" ? grnC : readTone == "bad" ? redC : color.new(#ffc247, 0)
    table.cell(panel, 0, 7, readVerd, text_color=readTxtC, bgcolor=color.new(readCol, 0), text_size=size.normal, text_halign=text.align_center)
    table.merge_cells(panel, 0, 7, 1, 7)
    table.cell(panel, 0, 8, readTxt, text_color=color.new(#dfe4ea, 0), bgcolor=dark, text_size=size.small, text_halign=text.align_left)
    table.merge_cells(panel, 0, 8, 1, 8)
    // ROW 9 — caveat, and (SPX only) the GEX levels' generation date + staleness.
    // The levels are a static paste; they DON'T auto-update when Vantage runs its
    // nightly job — so show which session they were built for, and flag STALE
    // once the chart has moved past it (re-pull the coach to refresh).
    todayStr = str.tostring(year, "0000") + "-" + str.tostring(month, "00") + "-" + str.tostring(dayofmonth, "00")
    gexStale = useGex and gexDate != "?" and todayStr > gexDate
    caveatTxt = useGex ? ("GEX levels · " + gexDate + (gexStale ? "  ⚠ STALE — re-pull" : "  ✓")) : "coach read — not a prediction"
    table.cell(panel, 0, 9, caveatTxt, text_color=gexStale ? color.new(#ffc247, 0) : color.new(#5a6270, 0), bgcolor=dark, text_size=size.tiny, text_halign=text.align_center)
    table.merge_cells(panel, 0, 9, 1, 9)

// ── alerts → webhook → Telegram ──────────────────────────────────────────────
// Set ONE alert on this indicator: condition "Any alert() function call",
// webhook URL = your Vantage /webhook/tradingview. The message is JSON carrying
// a shared SECRET (baked below) the endpoint validates, plus the full event so
// Telegram shows the live plan — not a static label. alert() fires once per bar
// close on the event bar (freq alert.freq_once_per_bar_close).
alertSecret = "{webhook_secret}"
f_alert(evt, headline, detail) =>
    msg = '{"secret":"' + alertSecret + '","source":"coach","event":"' + evt + '","symbol":"' + syminfo.ticker + '","headline":"' + headline + '","detail":"' + detail + '","price":' + str.tostring(close, "#.##") + '}'
    alert(msg, alert.freq_once_per_bar_close)

dirWord = tDir == 1 or showLong ? "LONG" : "SHORT"
if firedNow
    f_alert("TRIGGERED", (tDir == 1 ? "🔔 BUY CALLS" : "🔔 BUY PUTS") + " · " + armLbl + " " + str.tostring(tEntry, "#.#"), "target " + str.tostring(tT1, "#.#") + " · stop " + str.tostring(tStop, "#.#") + (na(armRR) ? "" : " · R:R " + str.tostring(armRR, "#.#")) + " · read: " + str.lower(readVerd))
if state == "SCALE" and state[1] != "SCALE"
    f_alert("SCALE", "✂️ SCALE OUT · " + dirWord + " from " + str.tostring(tEntry, "#.#"), "trim near " + str.tostring(scaleAt, "#.#") + " · " + str.lower(readVerd) + " with " + str.tostring(hdPts, "#") + "pt to target")
if state == "ARMED" and state[1] != "ARMED"
    f_alert("ARMED", "⏳ ARMED · " + dirWord + " " + armLbl + " " + str.tostring(armLevel, "#.#"), "trigger " + str.tostring(reclaimN) + " closes " + (showLong ? "above" : "below") + " · target " + str.tostring(armT1, "#.#") + " · stop " + str.tostring(armStop, "#.#") + (na(armRR) ? "" : " · R:R " + str.tostring(armRR, "#.#")))
if tOutcome == "TARGET HIT" and tOutcome[1] != "TARGET HIT"
    f_alert("TARGET", "✅ TARGET HIT · " + dirWord + " " + str.tostring(tT1, "#.#"), "closed at target from " + str.tostring(tEntry, "#.#"))
if tOutcome == "STOPPED" and tOutcome[1] != "STOPPED"
    f_alert("STOPPED", "🛑 STOPPED · " + dirWord + " " + str.tostring(tStop, "#.#"), "stopped from " + str.tostring(tEntry, "#.#"))

// ── PER-EVENT alertconditions (for TradingView plans WITHOUT "Any alert()") ───
// Each message is JSON carrying the baked secret + {{plot(...)}} placeholders
// TradingView fills at fire time, so the webhook still gets the live plan even
// though alertcondition text is otherwise a compile-time constant. Create one
// alert per condition below; the default message already contains everything —
// don't edit it. (On a plan that has "Any alert()", the richer alert() calls
// above are preferred; these remain as a fallback.)
alertcondition(stateChanged and state == "TRIGGERED", "Coach: TRIGGER", '{"secret":"{webhook_secret}","source":"coach","event":"TRIGGERED","symbol":"{{ticker}}","entry":{{plot("Entry")}},"target":{{plot("Target")}},"stop":{{plot("Stop")}},"rr":{{plot("RR")}},"price":{{close}}}')
alertcondition(stateChanged and state == "SCALE", "Coach: SCALE OUT", '{"secret":"{webhook_secret}","source":"coach","event":"SCALE","symbol":"{{ticker}}","entry":{{plot("Entry")}},"target":{{plot("Target")}},"stop":{{plot("Stop")}},"price":{{close}}}')
alertcondition(tOutcome == "TARGET HIT" and tOutcome[1] != "TARGET HIT", "Coach: TARGET HIT", '{"secret":"{webhook_secret}","source":"coach","event":"TARGET","symbol":"{{ticker}}","target":{{plot("Target")}},"price":{{close}}}')
alertcondition(tOutcome == "STOPPED" and tOutcome[1] != "STOPPED", "Coach: STOPPED", '{"secret":"{webhook_secret}","source":"coach","event":"STOPPED","symbol":"{{ticker}}","stop":{{plot("Stop")}},"price":{{close}}}')
alertcondition(stateChanged and state == "ARMED", "Coach: ARMED", '{"secret":"{webhook_secret}","source":"coach","event":"ARMED","symbol":"{{ticker}}","entry":{{plot("Entry")}},"target":{{plot("Target")}},"stop":{{plot("Stop")}},"rr":{{plot("RR")}},"price":{{close}}}')
'''
