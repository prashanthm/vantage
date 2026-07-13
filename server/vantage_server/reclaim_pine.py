"""Author the standalone, shareable Reclaim Strategy Pine artifacts.

Two self-contained TradingView scripts, computed LIVE on the chart (no Vantage
runtime dependency), that work on ANY symbol:

* ``build_reclaim_strategy()`` — a Pine v5 ``strategy()`` (backtestable in the
  Strategy Tester: win rate / P&L / drawdown natively);
* ``build_reclaim_indicator()`` — a Pine v5 ``indicator()`` (BUY/SELL arrows +
  entry/stop/target lines + alerts, no built-in backtest).

Both encode the SAME validated reclaim discipline as :mod:`reclaim_strategy`:
compute S/R from live pivots, enter after N consecutive closes back through a
level, stop STOP_PAD_PCT beyond it, target the next opposing level. The
defaults are SEEDED FROM the shared spec constants, so a test can assert the
generated Pine defaults equal the Python source of truth — Pine and Python
cannot drift.

Vantage's role here is authoring/refining the script; the emitted Pine is a
plain shareable file with no dependency on Vantage.
"""
from __future__ import annotations

from . import reclaim_strategy as spec

# The shared pivot/level + reclaim block — identical logic for both artifacts.
# Written once here; each builder wraps it with strategy()- or indicator()-
# specific entry/exit or plotting.
_CORE = """// ── Levels: paste GEX levels to trade ONLY those, else live fractal pivots ──
// Paste the levels from your GEX indicator (comma/space/newline separated),
// e.g. "7548, 7529, 7517, 7500, 7481, 7450". When non-empty, the reclaim trade
// fires ONLY on reclaims of these lines (levels below price = support, above =
// resistance) — this is what cuts the noise on a symbol you have GEX for. Leave
// BLANK to fall back to self-contained live pivots (works on any symbol).
gexInput = input.text_area("{gex_default}", "GEX / key levels (blank = live pivots)", group="Levels")

lvlTF = input.timeframe("60", "Level timeframe (HTF analysis)", group="Levels", tooltip="Levels come from THIS timeframe's pivots while you trade the chart timeframe — HTF structure, not chart-TF noise. 60 = 1h levels on a 5m/15m chart. Blank = chart timeframe (the old, noisier behavior). Ignored when GEX levels are pasted.")
pivotLen = input.int({pivot_len}, "Pivot length (level-timeframe bars)", minval=1, maxval=10, group="Levels", tooltip="Williams fractal half-width, in level-timeframe bars. Ignored when GEX levels are pasted.")
clusterTol = input.float(0.0, "S/R cluster tolerance (0 = auto)", minval=0, group="Levels", tooltip="Points within which pivots merge into one shelf. 0 auto-scales (~0.08% of price).")
maxDist = input.float(2.0, "Only trade levels within % of price", minval=0.1, maxval=50, group="Levels")

// ── Durable filter (live-pivot mode only) — cut the noise on any symbol ──
// A raw fractal pivot is not a level; a level is a pivot price returns to and
// respects. These gates keep only levels worth a reclaim. (GEX levels are
// already durable, so the filter is bypassed when GEX is pasted.)
minTouches = input.int({min_touches}, "Min touches to call a level durable", minval=1, maxval=6, group="Durable filter", tooltip="A pivot must be RE-TESTED this many times before it can trigger. 1 = every pivot (raw/noisy). 2-3 keeps only respected levels.")
minGapPct  = input.float({min_gap_pct}, "Min % gap from the last signal", minval=0.0, step=0.05, group="Durable filter", tooltip="Suppress a new signal within this % of the previous one — stops clusters of near-identical entries.")
minRR      = input.float({min_rr}, "Min R:R to T1 required", minval=0.0, step=0.1, group="Durable filter", tooltip="Skip a reclaim whose nearest target is not worth the stop. 0 = no R:R gate.")

// ── Confluence (live-pivot mode) — reclaims only where structure stacks ──
// BACKTESTED (frozen 60-session cache): 2 stacked dims is the validated bar —
// the champion config's levels all carry >=2; forcing 3 starved the edge
// (n 34->6, PF 2.99->1.26). Volume confirmation was tested and REJECTED
// (monotone harm: PF 2.99->1.18 as the gate tightened) — deliberately absent.
minDims = input.int({min_confluence}, "Min stacked dimensions to trade a level", minval=1, maxval=4, group="Confluence", tooltip="Dimensions that must stack at a level before the reclaim can fire there: the HTF pivot itself + fib / round number / prior-day H-L-C / daily 50-200 MA / second-TF pivot agreement. 2 = validated (pivot + one more). 1 = any durable pivot. GEX levels bypass (already curated).")
confTF2 = input.timeframe("240", "Second timeframe (pivot agreement)", group="Confluence")
fibLen = input.int(50, "Fib swing lookback (level-TF bars)", minval=10, maxval=300, group="Confluence")
confTol = input.float({conf_tol_pct}, "Stack tolerance (% of price)", minval=0.02, maxval=1.0, step=0.01, group="Confluence", tooltip="How close a fib/round/prior-day/MA/second-TF level must sit to the pivot to count as stacking. Default mirrors the backtested champion's zone-clustering tolerance; tighter values starve the gate (no levels).")

f_tol() => clusterTol > 0 ? clusterTol : close * 0.0008

// parse the pasted level list: entries separated by comma/newline, each a
// bare "price" or "price|label" — labels ride into the level table + chips
// (the prefilled export bakes them from the playbook scaffold)
f_parseLevels(txt) =>
    prices = array.new_float()
    names = array.new_string()
    parts = str.split(str.replace_all(txt, "\\n", ","), ",")
    if array.size(parts) > 0
        for i = 0 to array.size(parts) - 1
            kv = str.split(array.get(parts, i), "|")
            v = str.tonumber(str.replace_all(array.get(kv, 0), " ", ""))
            if not na(v) and v > 0
                array.push(prices, v)
                array.push(names, array.size(kv) > 1 ? array.get(kv, 1) : "")
    [prices, names]
[gexLevels, gexNames] = f_parseLevels(gexInput)
useGex = array.size(gexLevels) > 0

// price + touch-count per pivot level, so we can measure durability
var float[] sups = array.new_float()
var int[]   supHits = array.new_int()
var float[] ress = array.new_float()
var int[]   resHits = array.new_int()
// HTF pivots: computed on the LEVEL timeframe (same symbol; still fully
// self-contained — no external data). gaps_off repeats the value on every
// chart bar, so only a CHANGE marks a genuinely new HTF pivot.
// fixnan(): ta.pivothigh is na on all but pivot bars, and any comparison with
// na is na (falsy) — without fixnan the change-guard silently drops EVERY
// pivot and the level books stay empty. fixnan holds the last pivot price, so
// a CHANGE (or first value) marks exactly one new confirmed pivot.
[pvHr, pvLr, swHi, swLo] = request.security(syminfo.tickerid, lvlTF, [fixnan(ta.pivothigh(pivotLen, pivotLen)), fixnan(ta.pivotlow(pivotLen, pivotLen)), ta.highest(high, fibLen), ta.lowest(low, fibLen)], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_off)
pvH = not na(pvHr) and (na(pvHr[1]) or pvHr != pvHr[1]) ? pvHr : na
pvL = not na(pvLr) and (na(pvLr[1]) or pvLr != pvLr[1]) ? pvLr : na

// confluence sources: prior-day H/L/C, daily 50/200 MAs, second-TF pivots
[pdHi, pdLo, pdCl, dma50, dma200] = request.security(syminfo.tickerid, "D", [high[1], low[1], close[1], ta.sma(close, 50), ta.sma(close, 200)], lookahead=barmerge.lookahead_off)
[pvH2r, pvL2r] = request.security(syminfo.tickerid, confTF2, [fixnan(ta.pivothigh(pivotLen, pivotLen)), fixnan(ta.pivotlow(pivotLen, pivotLen))], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_off)
pvH2 = not na(pvH2r) and (na(pvH2r[1]) or pvH2r != pvH2r[1]) ? pvH2r : na
pvL2 = not na(pvL2r) and (na(pvL2r[1]) or pvL2r != pvL2r[1]) ? pvL2r : na
var float[] piv2 = array.new_float()
f_add2(price) =>
    if not na(price)
        dup = false
        if array.size(piv2) > 0
            for i = 0 to array.size(piv2) - 1
                if math.abs(array.get(piv2, i) - price) <= f_tol()
                    dup := true
        if not dup
            array.push(piv2, price)
            if array.size(piv2) > 16
                array.shift(piv2)
if not useGex
    f_add2(pvH2)
    f_add2(pvL2)

// a new pivot near an existing level = another TOUCH (durability++); else a new
// level at 1 touch. Oldest level drops when the ring buffer is full.
f_addLevel(arr, hits, price) =>
    merged = false
    if array.size(arr) > 0
        for i = 0 to array.size(arr) - 1
            if not merged and math.abs(array.get(arr, i) - price) <= f_tol()
                array.set(hits, i, array.get(hits, i) + 1)
                merged := true
    if not merged and not na(price)
        array.push(arr, price)
        array.push(hits, 1)
        if array.size(arr) > 24
            array.shift(arr)
            array.shift(hits)
// count a DISTINCT visit: +1 only when price crosses into a level it was NOT
// touching on the prior bar (not once per consolidating bar). This is what
// separates a respected level from a random pivot.
f_touch(arr, hits) =>
    if array.size(arr) > 0
        for i = 0 to array.size(arr) - 1
            lv = array.get(arr, i)
            inNow = low <= lv and high >= lv
            inPrev = low[1] <= lv and high[1] >= lv
            if inNow and not inPrev
                array.set(hits, i, array.get(hits, i) + 1)
// live-pivot mode only: accumulate swing pivots (GEX mode uses the fixed list)
if not useGex and not na(pvH)
    f_addLevel(ress, resHits, pvH)
if not useGex and not na(pvL)
    f_addLevel(sups, supHits, pvL)
if not useGex and barstate.isconfirmed
    f_touch(ress, resHits)
    f_touch(sups, supHits)

// nearest support below / resistance above the current price, from `arr`
f_nearestBelow(arr) =>
    best = float(na)
    if array.size(arr) > 0
        for i = 0 to array.size(arr) - 1
            v = array.get(arr, i)
            if v < close and (na(best) or v > best)
                best := v
    best
f_nearestAbove(arr) =>
    best = float(na)
    if array.size(arr) > 0
        for i = 0 to array.size(arr) - 1
            v = array.get(arr, i)
            if v > close and (na(best) or v < best)
                best := v
    best

// how many structural dimensions stack at `price` beyond the pivot itself,
// plus the human-readable story ("+ fib 61.8% + round")
f_roundStep() => close >= 5000 ? 50.0 : close >= 1000 ? 10.0 : close >= 200 ? 5.0 : close >= 50 ? 1.0 : 0.25
f_confluence(price) =>
    ctol = math.max(f_tol() * 2, price * confTol / 100)
    n = 0
    txt = ""
    step = f_roundStep()
    if math.abs(price - math.round(price / step) * step) <= ctol
        n += 1
        txt := txt + " + round"
    rng = swHi - swLo
    if rng > 0
        fr = 0.0
        rats = array.from(0.382, 0.5, 0.618, 0.786)
        for i = 0 to array.size(rats) - 1
            fv = swLo + rng * array.get(rats, i)
            if fr == 0.0 and math.abs(price - fv) <= ctol
                fr := array.get(rats, i)
        if fr > 0
            n += 1
            txt := txt + " + fib " + str.tostring(fr * 100, "#.#") + "%"
    if math.abs(price - pdHi) <= ctol or math.abs(price - pdLo) <= ctol or math.abs(price - pdCl) <= ctol
        n += 1
        txt := txt + " + prior day"
    if (not na(dma50) and math.abs(price - dma50) <= ctol) or (not na(dma200) and math.abs(price - dma200) <= ctol)
        n += 1
        txt := txt + " + daily MA"
    nearTF2 = false
    if array.size(piv2) > 0
        for i = 0 to array.size(piv2) - 1
            if math.abs(array.get(piv2, i) - price) <= ctol
                nearTF2 := true
    if nearTF2
        n += 1
        txt := txt + " + " + confTF2 + " pivot"
    [n, txt]

// the QUALIFIED subset (live-pivot mode): durable (retested >= minTouches) AND
// enough stacked dimensions (the pivot counts as 1) — the S/R the reclaim trades.
f_qualified(arr, hits) =>
    out = array.new_float()
    if array.size(arr) > 0
        for i = 0 to array.size(arr) - 1
            if array.get(hits, i) >= minTouches
                lv = array.get(arr, i)
                [cn, ctxt] = f_confluence(lv)
                if 1 + cn >= minDims
                    array.push(out, lv)
    out

// GEX mode: the "supports below / resistances above" are the pasted levels
// split by the current price. `f_gexSide` filters the fixed list.
f_gexSide(below) =>
    out = array.new_float()
    if array.size(gexLevels) > 0
        for i = 0 to array.size(gexLevels) - 1
            v = array.get(gexLevels, i)
            if (below and v < close) or (not below and v > close)
                array.push(out, v)
    out
supSet = useGex ? f_gexSide(true) : f_qualified(sups, supHits)
resSet = useGex ? f_gexSide(false) : f_qualified(ress, resHits)
nearSup = f_nearestBelow(supSet)
nearRes = f_nearestAbove(resSet)

// ── Reclaim trigger: {reclaim_closes} consecutive closes back through the level ──
confirmCloses = input.int({reclaim_closes}, "Reclaim confirmation closes", minval=1, maxval=5, group="Reclaim", tooltip="Consecutive closes back through a level before entry — the validated discipline (3 consecutive 5m closes beat every alternative tested; set the chart to 5m). 1 = single-bar.")
stopPad = input.float({stop_pad}, "Stop pad (% beyond the level)", minval=0.0, step=0.05, group="Reclaim")

// entry = the reclaimed level; stop = level ± pad; target = next opposing level.
// Computed before the signal so the durable filter can gate on R:R.
longEntry = nearSup
longStop = nearSup * (1 - stopPad / 100)
longTarget = f_nearestAbove(resSet)
shortEntry = nearRes
shortStop = nearRes * (1 + stopPad / 100)
shortTarget = f_nearestBelow(supSet)

// R:R to the nearest target (open-ended target passes the gate)
f_rrOk(entry, stop, target) =>
    minRR <= 0 or na(target) or (math.abs(entry - stop) > 0 and math.abs(target - entry) / math.abs(entry - stop) >= minRR)
// spacing: this signal must be >= minGapPct away from the previous one
var float lastSig = na
f_gapOk(price) =>
    minGapPct <= 0 or na(lastSig) or math.abs(price - lastSig) / price * 100 >= minGapPct

confirmed = barstate.isconfirmed
var bool tagLong = false
var int nLong = 0
var bool tagShort = false
var int nShort = 0

// LONG: price dips to support, then N closes back ABOVE it
if confirmed and not na(nearSup)
    if low <= nearSup
        tagLong := true
        nLong := close > nearSup ? 1 : 0
    else
        nLong := tagLong ? nLong + 1 : 0
longSignal = confirmed and not na(nearSup) and tagLong and nLong >= confirmCloses and (close - nearSup) / close * 100 <= maxDist and f_rrOk(longEntry, longStop, longTarget) and f_gapOk(longEntry)
if longSignal
    tagLong := false
    nLong := 0
    lastSig := longEntry

// SHORT: price rallies to resistance, then N closes back BELOW it
if confirmed and not na(nearRes)
    if high >= nearRes
        tagShort := true
        nShort := close < nearRes ? 1 : 0
    else
        nShort := tagShort ? nShort + 1 : 0
shortSignal = confirmed and not na(nearRes) and tagShort and nShort >= confirmCloses and (nearRes - close) / close * 100 <= maxDist and f_rrOk(shortEntry, shortStop, shortTarget) and f_gapOk(shortEntry)
if shortSignal
    tagShort := false
    nShort := 0
    lastSig := shortEntry
"""

_HEADER = """//@version=5
// Reclaim Strategy — the validated "enter on the reclaim, not the touch" setup.
// SELF-CONTAINED: computes its own S/R from live pivots and runs the reclaim
// trade on ANY symbol + timeframe (set the chart to 5m to match the validated
// 3-consecutive-5m-closes discipline). No external data dependency.
// NOT FINANCIAL ADVICE — context, not a guaranteed signal.
"""


def _core(gex_default: str = "") -> str:
    return _CORE.format(
        pivot_len=3,
        reclaim_closes=spec.RECLAIM_CLOSES,
        stop_pad=spec.STOP_PAD_PCT,
        min_touches=spec.MIN_TOUCHES,
        min_gap_pct=spec.MIN_GAP_PCT,
        min_rr=spec.MIN_RR,
        min_confluence=spec.MIN_CONFLUENCE,
        conf_tol_pct=spec.CONF_TOL_PCT,
        gex_default=gex_default,
    )


# levels worth baking into a prefilled indicator: the durable structural lines a
# reclaim should trade. The dealer-gamma (GEX) shelves + max-pain magnet, PLUS
# multiply-tested support/resistance and the volume PoC (they're durable by
# definition). Chart-derived fibs and round numbers are excluded — too many, too
# transient; the operator can still paste more by hand.
_PREFILL_KINDS = (
    "call wall", "put wall", "flip", "gamma", "max pain", "pain",  # GEX / dealer
    "tested", "poc", "magnet",                                     # durable chart
)


def _clean_label(lbl: str) -> str:
    """The Pine parser splits entries on "," and "|" — strip them from labels."""
    return (lbl or "").strip().replace("|", " ").replace(",", " ")


def gex_level_entries(scaffold: dict) -> list[tuple[float, str]]:
    """The KEY levels from a playbook scaffold as ``(price, label)`` pairs,
    high→low, de-duplicated.

    Prefers the scaffold's CURATED table rows — the same ~10 lettered levels the
    playbook itself shows (its selection logic already balanced GEX walls,
    confluence and durable keys; re-deriving from the raw 18-row ladder is what
    cluttered the chart). Falls back to a keyword filter over the ladder only
    for scaffolds without a table. Empty when there are no levels at all."""
    seen: set[int] = set()
    out: list[tuple[float, str]] = []
    for r in (scaffold.get("table") or {}).get("rows") or []:
        price = r.get("price")
        if price is None:
            continue
        key = round(float(price))
        if key not in seen:
            seen.add(key)
            out.append((round(float(price), 1), _clean_label(r.get("label"))))
    if out:
        return sorted(out, key=lambda e: -e[0])
    # fallback: older scaffolds without a curated table — filter the ladder
    for row in scaffold.get("level_ladder") or []:
        price = row.get("price")
        if price is None:
            continue
        kind = (row.get("kind") or "").strip()
        source = (row.get("source") or "").lower()
        if source == "gex" or any(k in kind.lower() for k in _PREFILL_KINDS):
            key = round(float(price))
            if key not in seen:
                seen.add(key)
                out.append((round(float(price), 1), _clean_label(kind)))
    return sorted(out, key=lambda e: -e[0])


def gex_levels_from_scaffold(scaffold: dict) -> list[float]:
    """Just the prices from :func:`gex_level_entries` (high→low)."""
    return [p for p, _ in gex_level_entries(scaffold)]


_STRATEGY_TAIL = """
// ── orders: enter on the reclaim, exit at target or stop ──
if longSignal
    strategy.entry("Long", strategy.long)
    strategy.exit("Long X", "Long", stop=longStop, limit=na(longTarget) ? na : longTarget)
if shortSignal
    strategy.entry("Short", strategy.short)
    strategy.exit("Short X", "Short", stop=shortStop, limit=na(shortTarget) ? na : shortTarget)

plotshape(longSignal, title="reclaim long", location=location.belowbar, style=shape.triangleup, color=color.new(#26A69A, 0), size=size.small, text="BUY")
plotshape(shortSignal, title="reclaim short", location=location.abovebar, style=shape.triangledown, color=color.new(#EF5350, 0), size=size.small, text="SELL")
"""

# NOTE: uses %d for the reclaim-closes count so no stray Pine braces collide.
# Only the CURRENT (most recent) signal carries the full entry/stop/target box;
# historical signals collapse to a bare BUY/SELL arrow so the chart stays
# readable. Active-trade lines EXTEND RIGHT (until the next signal replaces
# them) and ladder to T1/T2/T3 (the next %t opposing levels). The draw runs
# INLINE in global scope (Pine forbids reassigning a global var in a function).
_INDICATOR_TAIL = """
// detail level: full box on the latest signal, arrows for the rest
showActive = input.bool(true, "Show entry/stop/target on the latest signal", group="Display")
nTargets   = input.int(%t, "Targets (T1..Tn = next opposing levels)", minval=1, maxval=5, group="Display")
histLevels = input.bool(false, "Also keep faint stop/target stubs for past signals", group="Display", tooltip="Off by default. Historical detail boxes are what made the chart unreadable; arrows always mark every past signal.")

showTable = input.bool(true, "Show trade ticket table (bottom)", group="Display")

var line   acEntry  = na
var line   acStop   = na
var label  acLabel  = na
var line[] acTgtLines = array.new_line()
var label[] acTgtLabels = array.new_label()

// a persistent bottom-center table = the active trade's ticket (side / entry /
// stop / risk / T1..Tn with R:R). Created once, refilled on each new signal.
var table ticket = table.new(position.bottom_center, 2, 10, border_width=1, frame_width=1, frame_color=color.new(color.gray, 40))
f_ticketRow(row, k, v, txtcol) =>
    table.cell(ticket, 0, row, k, text_color=chart.fg_color, text_size=size.normal, text_halign=text.align_left, bgcolor=color.new(chart.bg_color, 15))
    table.cell(ticket, 1, row, v, text_color=txtcol, text_size=size.normal, text_halign=text.align_right, bgcolor=color.new(chart.bg_color, 15))

// ── the watched S/R levels, playbook-style: lettered chips + a level table ──
// Levels the reclaim is actually watching — GEX lines when pasted/baked, else
// the DURABLE pivot set — drawn across the chart with a letter chip at the
// right edge (A = highest), and a top-right table mapping letter → price →
// what the level is (baked GEX label, or pivot durability). Redrawn on the
// last bar so live-pivot levels stay current as durability accrues.
showLevels = input.bool(true, "Draw the S/R levels being watched", group="Display")
showLevelTable = input.bool(true, "Level table (top right)", group="Display")
maxLvls = input.int(8, "Max levels drawn (nearest kept)", minval=2, maxval=26, group="Display", tooltip="Cap on drawn levels — half above, half below, nearest to price first. Keeps a busy pivot book from cluttering the chart.")
var string[] LTRS = str.split("A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z", ",")
var line[] lvlLines = array.new_line()
var label[] lvlLabels = array.new_label()
var table lvlTbl = table.new(position.top_right, 2, 27, border_width=1, frame_width=1, frame_color=color.new(color.gray, 40))

// max touch count near a price in the raw pivot book (durability readout)
f_hitsNear(arr, hits, price) =>
    out = 0
    if array.size(arr) > 0
        for i = 0 to array.size(arr) - 1
            if math.abs(array.get(arr, i) - price) <= f_tol()
                out := math.max(out, array.get(hits, i))
    out

// the level's story: the baked/pasted GEX label, else pivot durability
f_levelName(price, isSup) =>
    out = ""
    if useGex
        if array.size(gexLevels) > 0
            for i = 0 to array.size(gexLevels) - 1
                if math.abs(array.get(gexLevels, i) - price) <= math.max(price * 0.0001, 0.01)
                    out := array.get(gexNames, i)
        if out == ""
            out := isSup ? "support" : "resistance"
    else
        n = isSup ? f_hitsNear(sups, supHits, price) : f_hitsNear(ress, resHits, price)
        [cn, ctxt] = f_confluence(price)
        out := (isSup ? "support" : "resistance") + (n > 0 ? " · " + str.tostring(n) + "x tested" : "") + ctxt
    out

f_drawLevel(price, isSup, ltr, row) =>
    col = isSup ? #26A69A : #EF5350
    array.push(lvlLines, line.new(bar_index - 1, price, bar_index, price, extend=extend.both, color=color.new(col, 45)))
    array.push(lvlLabels, label.new(bar_index + 2, price, ltr, style=label.style_label_left, color=color.new(col, 5), textcolor=color.white, size=size.normal))
    if showLevelTable
        table.cell(lvlTbl, 0, row, ltr + "  " + str.tostring(price, format.mintick), text_color=color.new(col, 0), text_size=size.normal, text_halign=text.align_right, bgcolor=color.new(chart.bg_color, 15))
        table.cell(lvlTbl, 1, row, f_levelName(price, isSup), text_color=chart.fg_color, text_size=size.normal, text_halign=text.align_left, bgcolor=color.new(chart.bg_color, 15))

if barstate.islast
    if array.size(lvlLines) > 0
        for i = 0 to array.size(lvlLines) - 1
            line.delete(array.get(lvlLines, i))
        array.clear(lvlLines)
    if array.size(lvlLabels) > 0
        for i = 0 to array.size(lvlLabels) - 1
            label.delete(array.get(lvlLabels, i))
        array.clear(lvlLabels)
    table.clear(lvlTbl, 0, 0, 1, 26)
    if showLevels
        resTmp = array.copy(resSet)
        supTmp = array.copy(supSet)
        // keep only the NEAREST levels per side (drop the farthest first);
        // a sparse side donates its unused budget to the other side.
        half = math.max(1, math.floor(maxLvls / 2))
        nRes = array.size(resTmp)
        nSup = array.size(supTmp)
        resKeep = math.min(nRes, half + math.max(0, half - nSup))
        supKeep = math.min(nSup, half + math.max(0, half - nRes))
        array.sort(resTmp, order.ascending)   // nearest resistance = lowest above
        array.sort(supTmp, order.descending)  // nearest support = highest below
        while array.size(resTmp) > resKeep
            array.pop(resTmp)
        while array.size(supTmp) > supKeep
            array.pop(supTmp)
        array.sort(resTmp, order.descending)  // letter top-down (A = highest)
        li = 0
        if array.size(resTmp) > 0
            for i = 0 to array.size(resTmp) - 1
                if li < 26
                    f_drawLevel(array.get(resTmp, i), false, array.get(LTRS, li), li)
                li += 1
        if array.size(supTmp) > 0
            for i = 0 to array.size(supTmp) - 1
                if li < 26
                    f_drawLevel(array.get(supTmp, i), true, array.get(LTRS, li), li)
                li += 1
        // honest empty state: say WHY the chart is bare instead of just being bare
        if li == 0 and showLevelTable
            table.cell(lvlTbl, 0, 0, "no levels", text_color=chart.fg_color, text_size=size.normal, text_halign=text.align_right, bgcolor=color.new(chart.bg_color, 15))
            table.cell(lvlTbl, 1, 0, useGex ? "no GEX levels parsed - check the input" : "no pivot passed durability + confluence yet - lower Min touches / Min stacked dims to loosen", text_color=chart.fg_color, text_size=size.normal, text_halign=text.align_left, bgcolor=color.new(chart.bg_color, 15))

// the next `n` opposing levels beyond `lvl`, nearest first (T1..Tn ladder)
f_ladder(isLong, lvl, n) =>
    out = array.new_float()
    src = isLong ? resSet : supSet
    // ascending for longs (resistances above), descending for shorts (supports below)
    if array.size(src) > 0
        tmp = array.copy(src)
        array.sort(tmp, order.ascending)
        if isLong
            for i = 0 to array.size(tmp) - 1
                v = array.get(tmp, i)
                if v > lvl and array.size(out) < n
                    array.push(out, v)
        else
            for i = array.size(tmp) - 1 to 0
                v = array.get(tmp, i)
                if v < lvl and array.size(out) < n
                    array.push(out, v)
    out

f_histStub(isLong, stop, target) =>
    line.new(bar_index, stop, bar_index + 2, stop, color=color.new(#EF5350, 70), style=line.style_dotted)
    if not na(target)
        line.new(bar_index, target, bar_index + 2, target, color=color.new(#26A69A, 70), style=line.style_dotted)

// the active trade for whichever signal fired this bar (long takes precedence)
sig      = longSignal or shortSignal
sigLong  = longSignal
sigEntry = longSignal ? longEntry : shortEntry
sigStop  = longSignal ? longStop : shortStop

// live status of the displayed trade, so a dead setup can't keep posing as
// active: +1 long / -1 short / 0 none; resolved once stop or T1 is hit.
var int   acDir  = 0
var float acEntryP = na
var float acStopP  = na
var float acT1     = na
var int   acBar    = na
var bool  acDone   = false

if sig and showActive
    line.delete(acEntry)
    line.delete(acStop)
    label.delete(acLabel)
    if array.size(acTgtLines) > 0
        for i = 0 to array.size(acTgtLines) - 1
            line.delete(array.get(acTgtLines, i))
        array.clear(acTgtLines)
    if array.size(acTgtLabels) > 0
        for i = 0 to array.size(acTgtLabels) - 1
            label.delete(array.get(acTgtLabels, i))
        array.clear(acTgtLabels)
    col = sigLong ? #26A69A : #EF5350
    acEntry := line.new(bar_index, sigEntry, bar_index + 1, sigEntry, extend=extend.right, color=color.new(col, 0), width=2)
    acStop  := line.new(bar_index, sigStop, bar_index + 1, sigStop, extend=extend.right, color=color.new(#EF5350, 10), style=line.style_dashed)
    risk = math.abs(sigEntry - sigStop)
    tgts = f_ladder(sigLong, sigEntry, nTargets)
    if array.size(tgts) > 0
        for i = 0 to array.size(tgts) - 1
            tv = array.get(tgts, i)
            tl = line.new(bar_index, tv, bar_index + 1, tv, extend=extend.right, color=color.new(#26A69A, 15 + i * 20), style=line.style_dashed)
            array.push(acTgtLines, tl)
            rr = risk > 0 ? math.round(math.abs(tv - sigEntry) / risk * 100) / 100 : na
            tt = "T" + str.tostring(i + 1) + " " + str.tostring(tv, format.mintick) + (na(rr) ? "" : "  R:R " + str.tostring(rr))
            array.push(acTgtLabels, label.new(bar_index, tv, tt, style=label.style_label_left, color=color.new(#26A69A, 10), textcolor=color.white, size=size.small))
    hdr = (sigLong ? "BUY " : "SELL ") + str.tostring(sigEntry, format.mintick) + "  stop " + str.tostring(sigStop, format.mintick)
    acLabel := label.new(bar_index, sigStop, hdr, style=label.style_label_left, color=color.new(col, 5), textcolor=color.white, size=size.normal)
    acDir := sigLong ? 1 : -1
    acEntryP := sigEntry
    acStopP := sigStop
    acT1 := array.size(tgts) > 0 ? array.get(tgts, 0) : na
    acBar := bar_index
    acDone := false
    // fill the bottom trade-ticket table
    if showTable
        table.clear(ticket, 0, 0, 1, 9)
        sideTxt = sigLong ? "LONG (reclaim support)" : "SHORT (fade resistance)"
        f_ticketRow(0, "Side", sideTxt, col)
        f_ticketRow(1, "Entry", str.tostring(sigEntry, format.mintick), color.new(col, 0))
        f_ticketRow(2, "Stop", str.tostring(sigStop, format.mintick), color.new(#EF5350, 0))
        f_ticketRow(3, "Risk", str.tostring(risk, format.mintick) + " (" + str.tostring(math.round(risk / sigEntry * 10000) / 100) + "%)", color.new(color.gray, 0))
        rowN = 4
        if array.size(tgts) > 0
            for i = 0 to array.size(tgts) - 1
                tv = array.get(tgts, i)
                rrv = risk > 0 ? math.round(math.abs(tv - sigEntry) / risk * 100) / 100 : na
                f_ticketRow(rowN, "T" + str.tostring(i + 1), str.tostring(tv, format.mintick) + (na(rrv) ? "" : "   R:R " + str.tostring(rrv)), color.new(#26A69A, 0))
                rowN += 1

// hide the ticket entirely when the table is toggled off
if not showTable
    table.clear(ticket, 0, 0, 1, 9)

// ── resolve the displayed trade: a dead setup must not pose as active ──
// After the signal bar, the first confirmed touch of the stop (or T1) settles
// it: lines gray out, the label gets the outcome, the ticket gains a Status
// row. Stop takes precedence when both print in one bar (conservative).
if confirmed and acDir != 0 and not acDone and bar_index > acBar
    stopHit = acDir == 1 ? low <= acStopP : high >= acStopP
    tgtHit = not na(acT1) and (acDir == 1 ? high >= acT1 : low <= acT1)
    if stopHit or tgtHit
        acDone := true
        outcome = stopHit ? "STOPPED" : "T1 HIT"
        okc = stopHit ? color.new(#EF5350, 0) : color.new(#26A69A, 0)
        if not na(acLabel)
            label.set_text(acLabel, label.get_text(acLabel) + "  -- " + outcome)
            label.set_color(acLabel, color.new(color.gray, 40))
        if not na(acEntry)
            line.set_color(acEntry, color.new(color.gray, 60))
        if not na(acStop)
            line.set_color(acStop, color.new(color.gray, 60))
        if array.size(acTgtLines) > 0
            for i = 0 to array.size(acTgtLines) - 1
                line.set_color(array.get(acTgtLines, i), color.new(color.gray, 70))
        if array.size(acTgtLabels) > 0
            for i = 0 to array.size(acTgtLabels) - 1
                label.set_color(array.get(acTgtLabels, i), color.new(color.gray, 60))
        if showTable
            f_ticketRow(9, "Status", outcome, okc)

if longSignal and histLevels
    f_histStub(true, longStop, longTarget)
if shortSignal and histLevels
    f_histStub(false, shortStop, shortTarget)

plotshape(longSignal, title="reclaim long", location=location.belowbar, style=shape.triangleup, color=color.new(#26A69A, 0), size=size.small, text="BUY")
plotshape(shortSignal, title="reclaim short", location=location.abovebar, style=shape.triangledown, color=color.new(#EF5350, 0), size=size.small, text="SELL")

// ── Alerts ──────────────────────────────────────────────────────────────────
// alert() fires AUTOMATICALLY on each filtered signal with the actual prices —
// no per-signal setup. Create ONE alert in TradingView on "Any alert() function
// call" and you get both directions. The alertcondition()s below are kept for
// users who prefer to wire a specific up/down alert by hand.
alertOn = input.bool(true, "Fire auto-alerts on signals", group="Alerts")
f_alertMsg(isLong) =>
    entry = isLong ? longEntry : shortEntry
    stp = isLong ? longStop : shortStop
    t1 = isLong ? longTarget : shortTarget
    rr = (not na(t1) and math.abs(entry - stp) > 0) ? math.round(math.abs(t1 - entry) / math.abs(entry - stp) * 100) / 100 : na
    (isLong ? "RECLAIM BUY " : "RECLAIM SELL ") + syminfo.ticker + " @ " + str.tostring(entry, format.mintick) + "  stop " + str.tostring(stp, format.mintick) + (na(t1) ? "" : "  T1 " + str.tostring(t1, format.mintick) + (na(rr) ? "" : "  R:R " + str.tostring(rr))) + "  (" + timeframe.period + ")"
if longSignal and alertOn
    alert(f_alertMsg(true), alert.freq_once_per_bar_close)
if shortSignal and alertOn
    alert(f_alertMsg(false), alert.freq_once_per_bar_close)

alertcondition(longSignal or shortSignal, title="Reclaim signal (any)", message="Reclaim signal on {{ticker}} ({{interval}}) — check the chart for side / entry / stop / targets.")
alertcondition(longSignal, title="Reclaim BUY", message="Reclaim BUY on {{ticker}} ({{interval}}): price reclaimed support after %d closes — enter, stop below, target next resistance.")
alertcondition(shortSignal, title="Reclaim SELL", message="Reclaim SELL on {{ticker}} ({{interval}}): price lost resistance after %d closes — enter, stop above, target next support.")
"""


def build_reclaim_strategy() -> str:
    """The backtestable Pine v5 ``strategy()`` — TradingView's Strategy Tester
    shows native win rate / P&L / drawdown."""
    decl = ('strategy("Reclaim Strategy", overlay=true, '
            'default_qty_type=strategy.percent_of_equity, default_qty_value=10, '
            'initial_capital=10000, commission_type=strategy.commission.percent, '
            'commission_value=0.01)\n\n')
    return _HEADER + decl + _core() + _STRATEGY_TAIL


def _indicator_tail() -> str:
    return (_INDICATOR_TAIL
            .replace("%t", str(spec.TARGET_COUNT))
            .replace("%d", str(spec.RECLAIM_CLOSES)))


def build_reclaim_indicator(gex_default: str = "") -> str:
    """The Pine v5 ``indicator()`` — arrows + entry/stop/target lines + alerts,
    no built-in backtest. ``gex_default`` prefills the GEX-levels input (blank =
    the generic, live-pivot, any-symbol version)."""
    decl = ('indicator("Reclaim Strategy (signals)", overlay=true, '
            'max_lines_count=100, max_labels_count=100)\n\n')
    return _HEADER + decl + _core(gex_default) + _indicator_tail()


def _sanitize_title(sym: str) -> str:
    """A Pine-title-safe symbol (drop quotes/newlines that would break the string)."""
    return "".join(c for c in sym if c.isalnum() or c in "._-").upper() or "SYMBOL"


def build_reclaim_indicator_for(symbol: str, scaffold: dict) -> str:
    """A PREFILLED, symbol-specific reclaim indicator: the symbol's current GEX
    levels are baked into the GEX-levels input default, so it trades ONLY those
    lines the moment it loads — no daily paste. The GEX values reflect the
    scaffold at generation time; regenerate when the levels move (0DTE: daily).

    A symbol with no GEX levels (no options gamma) yields no baked levels; the
    script then behaves exactly like the generic live-pivot version, so this is
    still safe to call for any symbol."""
    sym = _sanitize_title(symbol)
    entries = gex_level_entries(scaffold)
    levels = [p for p, _ in entries]
    gex_default = ", ".join(
        f"{_fmt_level(p)}|{lbl}" if lbl else _fmt_level(p) for p, lbl in entries)
    header = _HEADER + (
        f"// PREFILLED for {sym}: the GEX levels below are baked in from the "
        f"playbook\n// scaffold at export time. Reclaims fire ONLY on these "
        f"lines. Regenerate\n// when the GEX levels move (0DTE: each session). "
        f"Clear the input to fall\n// back to live pivots.\n"
        if levels else
        f"// PREFILLED for {sym}: no GEX levels were available at export time, "
        f"so this\n// runs as the generic live-pivot reclaim. Paste levels into "
        f"the input to\n// trade specific lines.\n"
    )
    decl = (f'indicator("Reclaim Strategy — {sym} (GEX)", overlay=true, '
            'max_lines_count=100, max_labels_count=100)\n\n')
    return header + decl + _core(gex_default) + _indicator_tail()


def _fmt_level(v: float) -> str:
    """Trim a level to a clean string (7500.0 -> "7500", 7481.5 -> "7481.5")."""
    return str(int(v)) if float(v).is_integer() else str(v)
