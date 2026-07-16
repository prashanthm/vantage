"""ICT feature-edge tests on the operator's REAL trades (1m persisted bars).
Reusable harness: tag each trade entry by ICT features and bucket P&L.
"""
import sys
sys.path.insert(0, "/app")
sys.path.insert(0, "/tmp")
from ict_engine import load, pivots, order_blocks, fresh_fvgs, atr
from vantage_server import session_activity as sa
from vantage_server import reclaim_pine as rp
from vantage_server.store import Store
from datetime import datetime as _dt

store = Store()
DAYS = ["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]


def entry_index(bar_dts, tdt):
    ei = None
    for k, b in enumerate(bar_dts):
        if b <= tdt:
            ei = k
    return ei


def sweeps_series(hi, lo, cl, op):
    _, sl, sh = order_blocks(hi, lo, cl, op)
    return sl, sh


def stat(g):
    if not g:
        return "none"
    w = sum(1 for x in g if x > 0)
    return f"n={len(g):>2} WR={w/len(g):.2f} net=${sum(g):>7.0f} avg=${sum(g)/len(g):>6.0f}"


def run(tagger, name, sweep_look=10):
    """tagger(ctx, trade_side, ei) -> bucket key. ctx carries the day's series."""
    buckets = {}
    for DAY in DAYS:
        d = load(DAY)
        if not d:
            continue
        ts, op, hi, lo, cl, vol = d
        bar_dts = [_dt.fromisoformat(t) for t in ts]
        sl, sh = sweeps_series(hi, lo, cl, op)
        obs, _, _ = order_blocks(hi, lo, cl, op)
        row = store.load_spx_playbook_before(DAY, symbol="SPX")
        scaf = (row or {}).get("scaffold") or {}
        levels = [float(p) for p, _ in rp.gex_level_entries(scaf)]
        ctx = dict(ts=ts, op=op, hi=hi, lo=lo, cl=cl, sl=sl, sh=sh, obs=obs,
                   levels=levels, look=sweep_look)
        sess = sa.session(store, DAY, "SPX")
        for t in sess["trades"]:
            if t.get("ticker") != "SPX" or not t.get("opened_at"):
                continue
            tdt = sa.to_et(t["opened_at"])
            ei = entry_index(bar_dts, tdt)
            if ei is None:
                continue
            side = "long" if "call" in t["label"] else "short"
            key = tagger(ctx, side, ei)
            buckets.setdefault(key, []).append(t.get("realized") or 0)
    print(f"\n=== {name} ===")
    for k in sorted(buckets, key=lambda x: -sum(buckets[x])):
        print(f"  {str(k):16}: {stat(buckets[k])}")
    return buckets


# ── H1: recent same-direction liquidity sweep before entry ──────────────────
def tag_sweep(ctx, side, ei):
    look = ctx["look"]
    lo0 = max(0, ei - look)
    if side == "long":   # enter long AFTER an SSL (low) sweep = the raid+reversal
        swept = any(ctx["sl"][k] for k in range(lo0, ei + 1))
    else:
        swept = any(ctx["sh"][k] for k in range(lo0, ei + 1))
    return "swept_then_entry" if swept else "no_sweep"


# ── H2: entry INSIDE a fresh directional OB zone ────────────────────────────
def _fresh_obs_at(ctx, ei):
    """OBs formed before ei that are NOT yet mitigated (price hasn't closed
    through the far side) as of ei."""
    out = []
    hi, lo, cl = ctx["hi"], ctx["lo"], ctx["cl"]
    for o in ctx["obs"]:
        if o["formed_i"] >= ei:
            continue
        # mitigated? bull OB filled if a close < bottom after formation; bear if close > top
        mit = False
        for k in range(o["formed_i"], ei + 1):
            if o["side"] == "bull" and cl[k] < o["bottom"]:
                mit = True; break
            if o["side"] == "bear" and cl[k] > o["top"]:
                mit = True; break
        if not mit:
            out.append(o)
    return out


def tag_ob(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = 0.25 * a
    want = "bull" if side == "long" else "bear"
    for o in _fresh_obs_at(ctx, ei):
        if o["side"] == want and (o["bottom"] - tol) <= epx <= (o["top"] + tol):
            return "in_fresh_OB"
    return "not_in_OB"


# ── H3: level + OB confluence (the coach's levels × ICT) ────────────────────
def tag_level_ob(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = 0.25 * a
    lvl = any(abs(epx - p) <= max(tol, epx * 0.0006) for p in ctx["levels"])
    want = "bull" if side == "long" else "bear"
    ob = any(o["side"] == want and (o["bottom"] - tol) <= epx <= (o["top"] + tol)
             for o in _fresh_obs_at(ctx, ei))
    return ("level+OB" if (lvl and ob) else "level_only" if lvl
            else "OB_only" if ob else "neither")


# ── H4: level x NEAR-an-OB (wider tolerance, includes tested OBs) ────────────
def _obs_near(ctx, ei, epx, want, mult=0.5):
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    band = mult * a
    for o in ctx["obs"]:
        if o["formed_i"] >= ei:
            continue
        if o["side"] != want:
            continue
        # within band of the zone (near, not strictly inside)
        if (o["bottom"] - band) <= epx <= (o["top"] + band):
            return True
    return False


def tag_level_obnear(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = max(0.25 * a, epx * 0.0006)
    want = "bull" if side == "long" else "bear"
    lvl = any(abs(epx - p) <= tol for p in ctx["levels"])
    obn = _obs_near(ctx, ei, epx, want, 0.5)
    return ("level+OBnear" if (lvl and obn) else "level_only" if lvl
            else "OBnear_only" if obn else "neither")


# ── H5: is the ENTRY on the wrong side of the draw? (level w/ opposing OB) ───
# The operator's -$5350: a LONG at a support level but with a BEARISH OB just
# overhead (the draw was DOWN). Test: level entries with an OPPOSING fresh OB
# nearby (long with a bear OB above / short with a bull OB below) = trap.
def tag_opposing_ob(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = max(0.25 * a, epx * 0.0006)
    lvl = any(abs(epx - p) <= tol for p in ctx["levels"])
    if not lvl:
        return "not_at_level"
    opp = "bear" if side == "long" else "bull"
    band = 2.0 * a   # an opposing OB within 2 ATR overhead/underfoot = the draw against you
    has_opp = False
    for o in ctx["obs"]:
        if o["formed_i"] >= ei or o["side"] != opp:
            continue
        if side == "long" and o["bottom"] > epx and (o["bottom"] - epx) <= band:
            has_opp = True
        if side == "short" and o["top"] < epx and (epx - o["top"]) <= band:
            has_opp = True
    return "level_opposing_OB" if has_opp else "level_clear"


# ── H6: is the entry WITH or AGAINST the nearest unfilled draw? ──────────────
# The draw = the nearest unfilled FVG magnet. If the nearest unfilled FVG is
# ABOVE the entry, the draw is UP → longs are WITH it, shorts AGAINST. Mirror
# below. This is the operator's core thesis (price seeks the imbalance).
def _nearest_draw(ctx, ei, epx):
    """Return ('up'|'down'|None, dist) — the side of the nearest unfilled FVG."""
    hi, lo = ctx["hi"], ctx["lo"]
    best = None
    for j in range(2, ei + 1):
        if lo[j] > hi[j-2]:
            zlo, zhi = hi[j-2], lo[j]
        elif hi[j] < lo[j-2]:
            zlo, zhi = hi[j], lo[j-2]
        else:
            continue
        # unfilled as of ei?
        if any(lo[m] <= zlo and hi[m] >= zlo for m in range(j+1, ei+1)):
            continue
        mid = (zlo + zhi) / 2
        d = abs(mid - epx)
        if best is None or d < best[1]:
            best = (("up" if mid > epx else "down"), d)
    return best if best else (None, None)


def tag_draw(ctx, side, ei):
    epx = ctx["cl"][ei]
    drawside, _ = _nearest_draw(ctx, ei, epx)
    if drawside is None:
        return "no_draw"
    with_draw = (side == "long" and drawside == "up") or (side == "short" and drawside == "down")
    return "with_draw" if with_draw else "against_draw"


# ── H7: draw direction GIVEN at a level (the actionable coach signal) ────────
def tag_level_draw(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = max(0.25 * a, epx * 0.0006)
    lvl = any(abs(epx - p) <= tol for p in ctx["levels"])
    if not lvl:
        return "not_at_level"
    drawside, _ = _nearest_draw(ctx, ei, epx)
    if drawside is None:
        return "level_no_draw"
    with_draw = (side == "long" and drawside == "up") or (side == "short" and drawside == "down")
    return "level_WITH_draw" if with_draw else "level_AGAINST_draw"


# ── H8: draw = the nearest PLAYBOOK LEVEL (HTF), not a 1m FVG ────────────────
# The corrected H6: the "draw" is the nearest opposing PLAYBOOK level (GEX wall /
# S-R / max pain / fib) beyond the entry — the HTF magnet. A long is WITH the draw
# if the nearest level ABOVE is closer/relevant; test with vs against.
def tag_level_target_draw(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = max(0.25 * a, epx * 0.0006)
    lvl = any(abs(epx - p) <= tol for p in ctx["levels"])
    if not lvl:
        return "not_at_level"
    above = [p for p in ctx["levels"] if p > epx + tol]
    below = [p for p in ctx["levels"] if p < epx - tol]
    up_dist = min((p - epx for p in above), default=1e9)
    dn_dist = min((epx - p for p in below), default=1e9)
    # the nearer opposing level = the likely draw
    draw_up = up_dist < dn_dist
    with_draw = (side == "long" and draw_up) or (side == "short" and not draw_up)
    return "level_WITHlvlDraw" if with_draw else "level_AGAINSTlvlDraw"


# ── H9: session timing — first 90 min vs midday vs last 90 min at a level ────
def tag_timing(ctx, side, ei):
    tstr = ctx["ts"][ei]
    hh = int(tstr[11:13]); mm = int(tstr[14:16]); m = hh * 60 + mm
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = max(0.25 * a, epx * 0.0006)
    lvl = any(abs(epx - p) <= tol for p in ctx["levels"])
    prefix = "lvl_" if lvl else "nolvl_"
    if m < 11 * 60:
        bucket = "open90"       # 9:30-11:00
    elif m < 14 * 60:
        bucket = "midday"       # 11:00-14:00
    else:
        bucket = "close2h"      # 14:00-16:00
    return prefix + bucket


# ── H10: the COMBINED avoid-flag — level & (midday OR against the level-draw) ─
# The synthesized warning: at a level, if it's midday OR the nearer opposing
# playbook level is against the trade, flag LOW-CONVICTION. Does flagging just
# these separate the losers?
def tag_avoid(ctx, side, ei):
    epx = ctx["cl"][ei]
    a = atr(ctx["hi"], ctx["lo"], ctx["cl"], ei)
    tol = max(0.25 * a, epx * 0.0006)
    lvl = any(abs(epx - p) <= tol for p in ctx["levels"])
    if not lvl:
        return "not_at_level"
    tstr = ctx["ts"][ei]; m = int(tstr[11:13]) * 60 + int(tstr[14:16])
    midday = 11 * 60 <= m < 14 * 60
    above = [p for p in ctx["levels"] if p > epx + tol]
    below = [p for p in ctx["levels"] if p < epx - tol]
    up_dist = min((p - epx for p in above), default=1e9)
    dn_dist = min((epx - p for p in below), default=1e9)
    draw_up = up_dist < dn_dist
    against = not ((side == "long" and draw_up) or (side == "short" and not draw_up))
    return "FLAG_low_conviction" if (midday or against) else "level_clean"


if __name__ == "__main__":
    import sys
    which = sys.argv[1] if len(sys.argv) > 1 else "h2"
    if which == "h1":
        run(tag_sweep, "H1 · recent same-direction liquidity sweep before entry")
    elif which == "h2":
        run(tag_ob, "H2 · entry inside a fresh directional OB zone")
    elif which == "h3":
        run(tag_level_ob, "H3 · level x OB confluence")
    elif which == "h4":
        run(tag_level_obnear, "H4 · level x NEAR-an-OB (0.5 ATR band)")
    elif which == "h5":
        run(tag_opposing_ob, "H5 · level entry with an OPPOSING OB (draw against you)")
    elif which == "h6":
        run(tag_draw, "H6 · entry WITH vs AGAINST the nearest unfilled draw (FVG)")
    elif which == "h7":
        run(tag_level_draw, "H7 · at a level: WITH vs AGAINST the draw")
    elif which == "h8":
        run(tag_level_target_draw, "H8 · draw = nearest PLAYBOOK level (HTF), with vs against")
    elif which == "h10":
        run(tag_avoid, "H10 · combined FLAG: level & (midday OR against level-draw)")
    elif which == "h9":
        run(tag_timing, "H9 · session timing x at-a-level")
