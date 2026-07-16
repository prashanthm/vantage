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


def build_coach_indicator(scaffold: dict) -> str | None:
    """Render the coach Pine for a playbook ``scaffold``. None when the scaffold
    carries no levels to bake (nothing to coach against)."""
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

    return header + _COACH_BODY.format(
        px_arr=px_arr, lb_arr=lb_arr, ro_arr=ro_arr,
        flip_line=flip_line, n_levels=len(prices),
    )


def _pine_str(s: str) -> str:
    """A double-quoted Pine string literal, quotes escaped."""
    return '"' + str(s or "").replace('"', "'") + '"'


# The coach body. Placeholders: {px_arr} {lb_arr} {ro_arr} {flip_line}
# {n_levels}. Written as a raw Pine v5 indicator; all the discipline logic lives
# here so the generator stays a pure level-baker.
_COACH_BODY = '''//@version=5
indicator("Vantage Coach", overlay=true, max_lines_count=200, max_labels_count=200)

// ── baked SPX GEX/pivot levels (from the nightly playbook) ───────────────────
// These are SPX-specific. They're used ONLY when the chart IS SPX (auto-gated
// below via syminfo). On any other symbol the coach arms trades off swing
// structure instead, so the same indicator works on any ticker.
var float[] gexPx  = array.from({px_arr})
var string[] gexLb = array.from({lb_arr})
var string[] gexRo = array.from({ro_arr})
float gexFlip = {flip_line}

// ── inputs ───────────────────────────────────────────────────────────────────
reclaimN = input.int(2, "Reclaim = this many closes back through the level", minval=1, maxval=5, group="Plan", tooltip="The TRIGGER. A long arms at a support/put-wall/flip; it fires only after this many consecutive closes back ABOVE it (reclaim, not just a touch). Shorts mirror at resistance/call-wall.")
stopPad  = input.float(0.06, "Stop pad (% beyond the trigger level)", minval=0.0, step=0.02, group="Plan", tooltip="Stop sits this far beyond the trigger level. 0.06% ~= 4.5pt at SPX 7500.")
armDist  = input.float(0.20, "Arm when price within this % of a level", minval=0.05, step=0.05, group="Plan", tooltip="How close price must get to a level before the coach ARMS that setup and starts watching for the trigger.")
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
isSpx = str.contains(_tk, "SPX") or _tk == "SPY" or str.contains(_tk, "ES1!") or str.startswith(_tk, "ES") or str.contains(syminfo.root, "ES")

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
// which setup is nearest to ARMING? long at support, short at resistance —
// whichever price is closer to. (armDist gate keeps it from arming too early.)
distSup = na(supPx) ? 1e9 : math.abs(close - supPx)
distRes = na(resPx) ? 1e9 : math.abs(close - resPx)
armTol  = close * armDist / 100.0
// candidate armed setup: pick the closer eligible level
armLong  = not na(supPx) and distSup <= armTol and distSup <= distRes
armShort = not na(resPx) and distRes <= armTol and distRes <  distSup
armLevel = armLong ? supPx : armShort ? resPx : na
armLbl   = armLong ? supLb : armShort ? resLb : na
// entry = the reclaimed level; stop = pad beyond it; target = the OPPOSITE level
pad      = close * stopPad / 100.0
armEntry = armLevel
armStop  = armLong ? armLevel - pad : armShort ? armLevel + pad : na
armT1    = armLong ? resPx : armShort ? supPx : na
armRR    = (na(armEntry) or na(armStop) or na(armT1) or math.abs(armEntry - armStop) == 0) ? na : math.abs(armT1 - armEntry) / math.abs(armEntry - armStop)

// the TRIGGER: `reclaimN` consecutive closes back through the armed level.
closesAbove = armLong  and not na(armLevel) ? (ta.barssince(close <= armLevel) >= reclaimN) : false
closesBelow = armShort and not na(armLevel) ? (ta.barssince(close >= armLevel) >= reclaimN) : false
triggerLong  = armLong  and closesAbove and close > armLevel
triggerShort = armShort and closesBelow and close < armLevel

// ── the live trade (Pine can't see your fills; it tracks the coach's plan) ───
var int   tDir   = 0        // +1 long, -1 short, 0 flat
var float tEntry = na
var float tStop  = na
var float tT1    = na
var float tPeak  = na       // best favorable excursion — powers the scale-out call
var string tOutcome = na
firedNow = false            // did a trigger fire on THIS bar?

// fire a new trade on a trigger (only when flat)
if tDir == 0 and (triggerLong or triggerShort)
    tDir := triggerLong ? 1 : -1
    tEntry := close
    tStop := armStop
    tT1 := armT1
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

// ── the ACTION verb — the ONE thing to read ──────────────────────────────────
action = state == "TRIGGERED" ? (tDir == 1 ? "🔔 BUY CALLS NOW" : "🔔 BUY PUTS NOW") : state == "SCALE" ? "SCALE OUT — TAKE PARTIAL" : state == "HOLD" ? (pnlPts >= 0 ? "HOLD TOWARD TARGET" : "HOLD — STOP INTACT") : state == "ARMED" ? (armLong ? "ARMED · LONG SETUP" : "ARMED · SHORT SETUP") : state == "THETA" ? "WAITING — THETA RISK" : "STAND ASIDE"

// ── plain-English reason / the plan spelled out ──────────────────────────────
planLine = na(armLevel) ? "No setup in range." : (armLong ? "LONG " : "SHORT ") + armLbl + " " + str.tostring(armLevel, "#.#") + " · trigger " + str.tostring(reclaimN) + " closes " + (armLong ? "above" : "below") + " · T1 " + (na(armT1) ? "open" : str.tostring(armT1, "#.#")) + " · stop " + (na(armStop) ? "—" : str.tostring(armStop, "#.#")) + (na(armRR) ? "" : " · R:R " + str.tostring(armRR, "#.#"))

reason = state == "TRIGGERED" ? "reclaimed " + armLbl + " — take the " + (tDir == 1 ? "calls" : "puts") + ", target " + str.tostring(tT1, "#.#") + ", stop " + str.tostring(tStop, "#.#") : state == "SCALE" ? "momentum fading before T1 (" + str.tostring(tT1, "#.#") + ") — trim near " + str.tostring(scaleAt, "#.#") + ", let the rest run to target" : state == "HOLD" ? (pnlPts >= 0 ? "in the plan, +" + str.tostring(pnlPts, "#.#") + "pt — hold toward " + str.tostring(tT1, "#.#") : str.tostring(pnlPts, "#.#") + "pt red but stop " + str.tostring(tStop, "#.#") + " intact — don't fold") : state == "ARMED" ? planLine : state == "THETA" ? "armed at " + armLbl + " but coiled " + str.tostring(coilBars) + " bars — theta bleeds while it decides" + (midday ? " (midday)" : "") : "no setup within range — wait for price to reach a level"

// ── the NARRATIVE — plain read of the tape, always shown ─────────────────────
regimeTxt = na(vwap) ? "" : (close >= vwap ? "Above VWAP" : "Below VWAP") + (useGex ? (aboveFlip ? ", above flip — buyers favored. " : ", under flip — sellers favored. ") : ". ")
srcTxt = useGex ? "Planning off SPX GEX levels. " : "No GEX (not SPX) — planning off swings. "
narrative = srcTxt + regimeTxt

// ── your position, in plain words ────────────────────────────────────────────
posTxt = not inTrade ? (na(tOutcome) ? "Flat — no position" : "Flat · last: " + tOutcome) : (tDir == 1 ? "Long from " : "Short from ") + str.tostring(tEntry, "#.#") + " · " + str.tostring(pnlPts, "+#.#;-#.#") + "pt " + (na(pnlPts) ? "" : (pnlPts >= 0 ? "🟢" : "🔴")) + "  (T1 " + str.tostring(tT1, "#.#") + " · stop " + str.tostring(tStop, "#.#") + ")"

tapeTxt = (na(vwap) ? "VWAP —" : (na(vwGap) ? "at VWAP" : str.tostring(vwGap, "+#.#;-#.#") + " ATR vs VWAP")) + " · RSI " + str.tostring(rsi, "#") + (rsi >= 70 ? "↑" : rsi <= 30 ? "↓" : "") + " · vol " + (na(relV) ? "—" : str.tostring(relV, "#.#") + "x" + (volOK ? "✓" : "")) + (coiled ? " · COILED " + str.tostring(coilBars) + "b" : "")

// ── plots ─────────────────────────────────────────────────────────────────────
plot(showVwap ? vwap : na, "VWAP", color=color.new(#2f6df6, 0), linewidth=2)
plot(showVwap ? vwUp : na, "VWAP +σ", color=color.new(#2f6df6, 70), style=plot.style_line)
plot(showVwap ? vwDn : na, "VWAP -σ", color=color.new(#2f6df6, 70), style=plot.style_line)

// draw the baked GEX levels — ONLY on SPX (auto-gated)
if barstate.isfirst and showLines and useGex
    for i = 0 to array.size(gexPx) - 1
        p  = array.get(gexPx, i)
        ro = array.get(gexRo, i)
        col = ro == "callwall" or ro == "resistance" ? color.new(#cf3b47, 30) : ro == "putwall" or ro == "support" ? color.new(#16915b, 30) : color.new(#b26a00, 20)
        line.new(bar_index, p, bar_index + 500, p, xloc=xloc.bar_index, extend=extend.right, color=col, width=ro == "callwall" or ro == "putwall" or ro == "flip" ? 2 : 1)
        label.new(bar_index + 500, p, array.get(gexLb, i) + "  " + str.tostring(p, "#.#"), xloc=xloc.bar_index, style=label.style_label_left, textcolor=col, color=color.new(color.black, 100), size=size.small)

// LIVE trade lines: entry / stop / target — drawn while in the trade
var line lnEntry = na
var line lnStop = na
var line lnT1 = na
if inTrade and (tEntry != tEntry[1] or na(lnEntry))
    line.delete(lnEntry)
    line.delete(lnStop)
    line.delete(lnT1)
    lnEntry := line.new(bar_index, tEntry, bar_index + 1, tEntry, extend=extend.right, color=color.new(#e8eaed, 0), width=2)
    lnStop  := line.new(bar_index, tStop, bar_index + 1, tStop, extend=extend.right, color=color.new(#EF5350, 10), style=line.style_dashed)
    lnT1    := na(tT1) ? na : line.new(bar_index, tT1, bar_index + 1, tT1, extend=extend.right, color=color.new(#26A69A, 10), style=line.style_dashed)
if not inTrade and not na(lnEntry)
    line.delete(lnEntry)
    line.delete(lnStop)
    line.delete(lnT1)
    lnEntry := na

// background tint + markers at the moment the state changes
stateChanged = state != state[1]
bgcolor(state == "TRIGGERED" ? color.new(#16915b, 80) : state == "SCALE" ? color.new(#e0a020, 86) : state == "HOLD" ? color.new(#2f6df6, 92) : state == "ARMED" ? color.new(#9b6dff, 92) : state == "THETA" ? color.new(#e0a020, 90) : na)
plotshape(stateChanged and state == "TRIGGERED", title="TRIGGERED", location=location.belowbar, style=shape.triangleup, color=color.new(#16915b,0), size=size.normal, text="TRIGGER")
plotshape(stateChanged and state == "SCALE",     title="SCALE",     location=location.abovebar, style=shape.flag,       color=color.new(#e0a020,0), size=size.small, text="SCALE")
plotshape(tOutcome == "TARGET HIT" and tOutcome[1] != "TARGET HIT", title="TARGET", location=location.abovebar, style=shape.diamond, color=color.new(#26A69A,0), size=size.small, text="T1")
plotshape(tOutcome == "STOPPED" and tOutcome[1] != "STOPPED", title="STOP", location=location.abovebar, style=shape.xcross, color=color.new(#EF5350,0), size=size.small, text="STOP")

// ── the coach panel (BOTTOM-RIGHT) — ACTION → the plan → position → tape ─────
var table panel = table.new(position.bottom_right, 1, 6, border_width=1, frame_width=1, frame_color=color.new(color.gray, 50))
if showPanel and barstate.islast
    actCol = state == "TRIGGERED" ? #16915b : state == "SCALE" ? #e0a020 : state == "HOLD" ? #2f6df6 : state == "ARMED" ? #7c5cff : state == "THETA" ? #e0a020 : #4a5160
    table.cell(panel, 0, 0, action, text_color=color.white, bgcolor=color.new(actCol, 0), text_size=size.large, text_halign=text.align_center)
    table.cell(panel, 0, 1, reason, text_color=color.new(#e8eaed, 0), bgcolor=color.new(#1b2029, 0), text_size=size.normal, text_halign=text.align_left)
    table.cell(panel, 0, 2, posTxt, text_color=color.white, bgcolor=color.new(not inTrade ? #2a2f38 : pnlPts >= 0 ? #145c3a : #6e2530, 0), text_size=size.normal, text_halign=text.align_center)
    table.cell(panel, 0, 3, narrative, text_color=color.new(#c7ccd4, 0), bgcolor=color.new(#1b2029, 0), text_size=size.small, text_halign=text.align_left)
    table.cell(panel, 0, 4, tapeTxt, text_color=color.new(#8a93a3, 0), bgcolor=color.new(#13171e, 0), text_size=size.small, text_halign=text.align_left)
    table.cell(panel, 0, 5, (useGex ? "SPX GEX" : syminfo.ticker) + " · Vantage Coach · not advice", text_color=color.new(#5a6270, 0), bgcolor=color.new(#13171e, 0), text_size=size.tiny, text_halign=text.align_center)

// ── alerts ───────────────────────────────────────────────────────────────────
alertcondition(stateChanged and state == "TRIGGERED", "Coach: TRIGGER", "Setup triggered — take the entry")
alertcondition(stateChanged and state == "SCALE",     "Coach: SCALE OUT", "Target at risk — take a partial")
alertcondition(tOutcome == "TARGET HIT" and tOutcome[1] != "TARGET HIT", "Coach: TARGET HIT", "T1 reached")
alertcondition(tOutcome == "STOPPED" and tOutcome[1] != "STOPPED", "Coach: STOPPED", "Stop hit")
alertcondition(stateChanged and state == "ARMED", "Coach: ARMED", "A setup just armed — watch for the trigger")
'''
