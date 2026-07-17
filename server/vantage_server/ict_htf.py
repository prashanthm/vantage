"""Hourly ICT signal layer — the backtest-validated concepts, ported to production.

The `ict-concepts-edge` goal (claudedocs/goals/ict-concepts-edge/) backtested every
mechanically-definable ICT concept on 3 years of SPX HOURLY data. Six confirmed;
the two tradeable SIGNALS were:

  - CONFLUENCE STACK  (sweep -> displacement-FVG in the reversal dir): +0.59R/trade
  - FVG-REACTION (displacement-gated): +0.42R/trade, the workhorse

This module is the FAITHFUL port of the validated scratch detectors
(server/scratch/ict_concepts_backtest.py) so the shipped signal set reproduces the
backtest exactly (asserted by tests/test_htf_signals.py). Validated constants,
carried verbatim: REV_ATR=1.0, REV_BARS=6, displacement gate body>0.7*ATR on the
FVG middle candle, post-sweep window look=8, CE entry on first return, far-edge stop.

These are SWING/HOURLY concepts — disproved at 1m by the ict-coach goal. The coach
uses `htf_setup()` as a HEADS-UP ("hourly setup present -> drop to a lower timeframe
for entry"), NOT an auto-fired entry. DISPROVEN concepts (FVG-fill, premium/discount,
IPDA, OTE-as-trade) are intentionally NOT here.
"""
from __future__ import annotations

from . import ict

REV_ATR = 1.0      # reversal magnitude (in hourly ATR) that counts as a reaction
REV_BARS = 6       # window (hourly bars) to realize the reversal
DISP_MULT = 0.7    # displacement gate: FVG middle-candle body > 0.7*ATR
LOOK_SWEEP = 8     # bars after a sweep to find the displacement FVG (confluence)
LOOK_FILL = 40     # bars to wait for first return into an FVG


def _atr(hi, lo, cl, i, n=14):
    return ict.atr(hi, lo, cl, i, n)


def _all_fvgs(hi, lo):
    """Every FVG at formation, fill-agnostic. bull: lo[j]>hi[j-2] -> zone
    (hi[j-2], lo[j]); bear: hi[j]<lo[j-2] -> zone (hi[j], lo[j-2]). formed_i=j."""
    out = []
    for j in range(2, len(hi)):
        if lo[j] > hi[j - 2]:
            out.append({"side": "bull", "lo": hi[j - 2], "hi": lo[j], "formed_i": j})
        elif hi[j] < lo[j - 2]:
            out.append({"side": "bear", "lo": hi[j], "hi": lo[j - 2], "formed_i": j})
    return out


def _pivot_pools_before(hi, lo, i, piv=2):
    """Unswept pivot highs/lows confirmed strictly before bar i. Returns
    (bsl, ssl) lists of (bar_index, price)."""
    ph, pl = ict.pivots(hi[:i], lo[:i], piv)
    bsl = [(j, p) for j, p in ph.items()
           if not any(hi[k] > p for k in range(j + piv + 1, i))]
    ssl = [(j, p) for j, p in pl.items()
           if not any(lo[k] < p for k in range(j + piv + 1, i))]
    return bsl, ssl


def _is_displacement(cl, op, formed_i, hatr):
    """The FVG's middle candle (formed_i-1) displaced: body > DISP_MULT*ATR."""
    mid = formed_i - 1
    return hatr and abs(cl[mid] - op[mid]) > DISP_MULT * hatr


def confluence_signals(hi, lo, cl, op, piv=2, look=LOOK_SWEEP):
    """The validated CONFLUENCE STACK (+0.59R). Within `look` bars AFTER a sweep of
    an unswept pivot pool, a DISPLACEMENT FVG forms in the reversal direction; enter
    at its CE on first return. Returns [(ti, dir, ce, far, formed_i)] — dir +1 long
    / -1 short. (Faithful port of scratch concept_confluence; the 5th field
    formed_i is added for the snapshot/UI, ignored by the parity test's 4-tuple.)"""
    N = len(cl)
    fvg_by_bar = {}
    for f in _all_fvgs(hi, lo):
        fvg_by_bar.setdefault(f["formed_i"], []).append(f)
    sigs = []
    seen = set()
    for i in range(30, N - REV_BARS - 1):
        bsl, ssl = _pivot_pools_before(hi, lo, i, piv)
        swept_dir = 0
        for j, p in bsl:
            if (j, "b") not in seen and hi[i] > p and cl[i] < p:
                seen.add((j, "b")); swept_dir = -1; break
        if swept_dir == 0:
            for j, p in ssl:
                if (j, "s") not in seen and lo[i] < p and cl[i] > p:
                    seen.add((j, "s")); swept_dir = +1; break
        if swept_dir == 0:
            continue
        for k in range(i, min(i + look, N)):
            for f in fvg_by_bar.get(k, []):
                want = "bull" if swept_dir > 0 else "bear"
                if f["side"] != want:
                    continue
                fi = f["formed_i"]
                hatr = _atr(hi, lo, cl, fi, 14)
                if not _is_displacement(cl, op, fi, hatr):
                    continue
                ce = (f["hi"] + f["lo"]) / 2
                ti = None
                for m in range(fi + 1, min(fi + 1 + LOOK_FILL, N)):
                    if lo[m] <= f["hi"] and hi[m] >= f["lo"]:
                        ti = m; break
                if ti is None or ti >= N - 2:
                    continue
                far = f["lo"] if swept_dir > 0 else f["hi"]
                sigs.append((ti, swept_dir, ce, far, fi))
                break
            else:
                continue
            break
    return sigs


def fvg_reaction_signals(hi, lo, cl, op, look=LOOK_FILL, displacement_only=False):
    """The validated FVG-REACTION signal (+0.42R). First return into an FVG, enter
    at CE, stop beyond far edge. Returns [(ti, dir, ce, far, formed_i)]. Set
    displacement_only=True for the higher-conviction subset (C12: 0.766 vs 0.680)."""
    N = len(cl)
    out = []
    for f in _all_fvgs(hi, lo):
        j = f["formed_i"]
        if displacement_only:
            hatr = _atr(hi, lo, cl, j, 14)
            if not _is_displacement(cl, op, j, hatr):
                continue
        ce = (f["hi"] + f["lo"]) / 2
        ti = None
        for k in range(j + 1, min(j + 1 + look, N)):
            if lo[k] <= f["hi"] and hi[k] >= f["lo"]:
                ti = k; break
        if ti is None or ti >= N - 2:
            continue
        direction = 1 if f["side"] == "bull" else -1
        far = f["lo"] if direction > 0 else f["hi"]
        out.append((ti, direction, ce, far, j))
    return out


# ── the tiered heads-up the snapshot emits ──────────────────────────────────
# Hour-of-day buckets (ET clock HOUR), from the validated expansion decay (C9):
# the NY-AM open hours carry ~2x the range of the afternoon drift. Matched on the
# HOUR only ("HH"), so the caller can pass either a top-of-hour label or a live
# 'HH:MM' — 09/10 = AM expansion; 12-15 = PM drift.
_AM_HOURS = {"09", "10"}
_PM_DRIFT = {"12", "13", "14", "15"}


def _hour_bucket(hour_of_day):
    """Normalize 'HH:MM' (or 'HH') to the ET clock hour 'HH'."""
    return str(hour_of_day or "").split(":")[0].zfill(2)


def _overlaps_ob(ce, active_obs):
    """Is the entry CE inside an active order-block zone? (OB-backed → bumps tier.)"""
    for o in active_obs or []:
        top = o.get("top"); bot = o.get("bottom")
        if top is not None and bot is not None and bot <= ce <= top:
            return True
    return False


def htf_setup(hi, lo, cl, op, hour_of_day, active_obs=None, near_atr=3.0):
    """The heads-up: the most-recent still-actionable hourly setup near current
    price, with the tier decided by the validated modifiers. Returns a dict the
    snapshot embeds as `ict_htf`. `hour_of_day` is the ET 'HH:MM' of the last bar;
    `active_obs` is the snapshot's active_order_blocks (for the OB-backed bump)."""
    N = len(cl)
    if N < 32:
        return {"present": False}
    price = cl[N - 1]
    hatr = _atr(hi, lo, cl, N - 1, 14) or 0.0
    near = near_atr * hatr if hatr else float("inf")

    conf = confluence_signals(hi, lo, cl, op)
    fvgr = fvg_reaction_signals(hi, lo, cl, op, displacement_only=True)

    def _recent_near(sigs):
        # most recent signal whose CE is within `near` of price, newest first
        best = None
        for s in sigs:
            ti, d, ce, far, fi = s
            if abs(ce - price) <= near and (best is None or ti > best[0]):
                best = (ti, d, ce, far, fi)
        return best

    c = _recent_near(conf)
    f = _recent_near(fvgr)

    # base tier: confluence -> A+ candidate; disp-FVG only -> B
    chosen = None; base = None
    if c is not None:
        chosen = c; base = "A+"
    elif f is not None:
        chosen = f; base = "B"
    if chosen is None:
        return {"present": False}

    ti, d, ce, far, fi = chosen
    ob_backed = _overlaps_ob(ce, active_obs)

    tier = base
    reasons = []
    if base == "A+":
        reasons.append("sweep → displacement FVG (confluence)")
    else:
        reasons.append("displacement-gated FVG reaction")
        if ob_backed:
            tier = "A+"; reasons.append("order-block-backed")

    # hour-of-day modifier (C9 expansion decay)
    hb = _hour_bucket(hour_of_day)
    if hb in _AM_HOURS:
        reasons.append("NY-AM hour (expansion)")
    elif hb in _PM_DRIFT:
        # PM drift damps: demote A+ -> B; suppress a bare (non-OB) B
        if tier == "A+" and not (base == "A+"):
            tier = "B"
        if tier == "B" and base == "B" and not ob_backed:
            return {"present": False, "suppressed": "pm-drift"}
        reasons.append("PM drift — reduced conviction")

    direction = "long" if d > 0 else "short"
    invalid = far  # the far FVG edge is the structural invalidation reference
    return {
        "present": True,
        "tier": tier,
        "dir": direction,
        "ce": round(ce, 2),
        "entry_zone": [round(min(ce, far), 2), round(max(ce, far), 2)],
        "invalid": round(invalid, 2),
        "ob_backed": ob_backed,
        "hour": hour_of_day,
        "reason": " · ".join(reasons),
    }
