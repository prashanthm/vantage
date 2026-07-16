"""Backtest the COACH indicator's OWN arm/trigger/target/stop rules.

This is distinct from ``backtest.py`` (which replays the paper ticket pipeline)
and from ``coach_backtest.py`` (which mirrored the retired discipline engine).
Here we replay the plan-execution coach exactly as ``coach_pine.py`` runs it:

  ARM   — price within ``arm_dist`` of a support (long) or resistance (short),
          taken from the SAME baked GEX ladder the coach uses.
  TRIGGER — ``reclaim_n`` consecutive closes back through the level.
  ENTRY — the reclaim close (like the live coach: entry is where it fires).
  STOP  — level -/+ ``stop_pad``.
  T1    — the next OPPOSING level beyond the entry.
  RR gate — with ``rr_min`` set, a setup only arms if T1 is a valid target
            (strictly beyond entry) AND R:R >= rr_min. This is the candidate fix.

Settlement is first-touch stop/target on the same bars, EOD mark-to-close, the
same conservative rule as backtest.py (a bar touching both = stop).

Run:  .venv/bin/python -m vantage_server.coach_rules_backtest \
        --cache backtest_data/bars_frozen.json [--rr-min 1.5] [--arm-dist 0.2]
"""
from __future__ import annotations

import argparse
import json

from . import backtest as _bt
from . import reclaim_pine as _rp
from . import coach_pine as _cp


def _levels_for_day(bars, proxy_bars, day, cfg, history_rows, params):
    """The level ladder the coach plans off for `day`, as (price, role) pairs.

    IMPORTANT: GEX levels are a LIVE-ONLY input — the historical scaffold has no
    GEX table (``gex_level_entries`` returns []), so the coach's SPX GEX path is
    NOT backtestable here. We fall back to the CONFLUENCE zones (support/
    resistance clusters) — the SAME levels the paper pipeline plans off and that
    the strategy-winrate / coach-edge backtests validated. This measures the
    coach's arm/trigger/target/RR MECHANICS on real levels; it does not (cannot)
    validate the GEX overlay."""
    scaf = _bt.scaffold_asof(bars, proxy_bars, day, cfg, history_rows, params)
    entries = _rp.gex_level_entries(scaf)          # (price, label) — empty historically
    if entries:
        return [(float(p), _cp._classify(lbl)) for p, lbl in entries]
    # fall back to confluence zones (what actually exists in history)
    out = []
    for z in scaf.get("confluence") or []:
        role = z.get("role")
        if role in ("support", "resistance") and z.get("price"):
            out.append((float(z["price"]), role))
    return out


def _nearest(levels, close, longable_roles, shortable_roles):
    """Nearest support-ish below/at close and resistance-ish above/at close."""
    sup = res = None
    for p, ro in levels:
        if p <= close and ro in longable_roles:
            if sup is None or (close - p) < (close - sup[0]):
                sup = (p, ro)
        if p >= close and ro in shortable_roles:
            if res is None or (p - close) < (res[0] - close):
                res = (p, ro)
    return sup, res


LONGABLE = {"support", "putwall", "flip"}
SHORTABLE = {"resistance", "callwall", "flip"}


def backtest_coach(bars_by_symbol, params=None):
    p = dict(_bt.DEFAULT_PARAMS)
    p.update(params or {})
    arm_dist = p.get("arm_dist", 0.20) / 100.0
    reclaim_n = p.get("confirm_closes", 2) or 2
    stop_pad = p.get("stop_pad_pct", 0.06) / 100.0
    rr_min = p.get("rr_min")            # None = no gate (reproduce current coach)
    unders = p.get("coach_underlyings", ["SPX"])

    trades = []
    counts = {"sessions": 0, "armed": 0, "triggered": 0, "no_target": 0,
              "below_rr": 0}

    for u in unders:
        cfg = _bt._u.get(u)
        if cfg is None:
            continue
        bars = bars_by_symbol.get(cfg["bar_symbol"])
        proxy = bars if cfg["self_proxy"] else bars_by_symbol.get(cfg["proxy_symbol"])
        if bars is None:
            continue
        hist = []
        for day in _bt._sessions(bars):
            day_bars = _bt._day_slice(bars, day)
            if day_bars is None or len(day_bars) < 6:
                continue
            counts["sessions"] += 1
            levels = _levels_for_day(bars, proxy, day, cfg, hist, p)
            if not levels:
                continue
            closes = list(day_bars["Close"])
            highs = list(day_bars["High"])
            lows = list(day_bars["Low"])
            n = len(closes)

            in_trade = False
            tdir = 0
            entry = stop = t1 = 0.0
            i = 0
            while i < n:
                c = closes[i]
                if not in_trade:
                    sup, res = _nearest(levels, c, LONGABLE, SHORTABLE)
                    # try LONG at support: reclaim_n closes back above it
                    armed = None
                    if sup is not None and abs(c - sup[0]) <= c * arm_dist:
                        lvl = sup[0]
                        if i + 1 >= reclaim_n and all(
                                closes[i - k] > lvl for k in range(reclaim_n)) and c > lvl:
                            armed = ("long", lvl, res)
                    if armed is None and res is not None and abs(c - res[0]) <= c * arm_dist:
                        lvl = res[0]
                        if i + 1 >= reclaim_n and all(
                                closes[i - k] < lvl for k in range(reclaim_n)) and c < lvl:
                            armed = ("short", lvl, sup)
                    if armed is not None:
                        counts["armed"] += 1
                        side, lvl, opp = armed
                        e = c                       # entry = reclaim close
                        s = lvl - c * stop_pad if side == "long" else lvl + c * stop_pad
                        # T1 = the opposing level, but ONLY if strictly beyond entry
                        tgt = None
                        if opp is not None:
                            op = opp[0]
                            if side == "long" and op > e:
                                tgt = op
                            elif side == "short" and op < e:
                                tgt = op
                        if tgt is None:
                            counts["no_target"] += 1
                        risk = abs(e - s)
                        rr = (abs(tgt - e) / risk) if (tgt is not None and risk > 0) else None
                        # RR gate (the candidate fix): skip if no valid target or below floor
                        if rr_min is not None and (rr is None or rr < rr_min):
                            counts["below_rr"] += 1
                            i += 1
                            continue
                        counts["triggered"] += 1
                        in_trade = True
                        tdir = 1 if side == "long" else -1
                        entry, stop, t1 = e, s, (tgt if tgt is not None else 0.0)
                        fill_i = i
                    i += 1
                    continue
                # in a trade: first-touch stop/target from the fill bar onward
                hit_stop = (lows[i] <= stop) if tdir == 1 else (highs[i] >= stop)
                hit_tgt = t1 and ((highs[i] >= t1) if tdir == 1 else (lows[i] <= t1))
                if hit_stop:
                    trades.append({"u": u, "side": "long" if tdir == 1 else "short",
                                   "entry": entry, "exit": stop, "reason": "stop",
                                   "pnl_pct": (stop - entry) / entry * 100 * tdir})
                    in_trade = False
                elif hit_tgt:
                    trades.append({"u": u, "side": "long" if tdir == 1 else "short",
                                   "entry": entry, "exit": t1, "reason": "target",
                                   "pnl_pct": (t1 - entry) / entry * 100 * tdir})
                    in_trade = False
                i += 1
            if in_trade:                            # EOD mark-to-close
                ex = closes[-1]
                trades.append({"u": u, "side": "long" if tdir == 1 else "short",
                               "entry": entry, "exit": ex, "reason": "eod",
                               "pnl_pct": (ex - entry) / entry * 100 * tdir})
            hist.append({"day": day})

    return _summarize(trades, counts, p)


def _summarize(trades, counts, params):
    wins = [t for t in trades if t["pnl_pct"] > 0]
    losses = [t for t in trades if t["pnl_pct"] < 0]
    gw = sum(t["pnl_pct"] for t in wins)
    gl = sum(t["pnl_pct"] for t in losses)
    n = len(trades)
    # wrong-side audit: a "target" exit that lost money = wrong-side target bug
    wrong_side = [t for t in trades if t["reason"] == "target" and t["pnl_pct"] < 0]
    metrics = {
        "overall": {
            "n": n,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(len(wins) / n, 4) if n else None,
            "profit_factor": round(gw / abs(gl), 3) if gl else None,
            "net_pct": round(sum(t["pnl_pct"] for t in trades), 3),
            "by_reason": {r: sum(1 for t in trades if t["reason"] == r)
                          for r in ("target", "stop", "eod")},
            "wrong_side_target_losses": len(wrong_side),
        }
    }
    return {"params": {k: params[k] for k in ("confirm_closes", "rr_min", "arm_dist",
                       "stop_pad_pct") if k in params},
            "counts": counts, "metrics": metrics}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--rr-min", type=float, default=None)
    ap.add_argument("--arm-dist", type=float, default=0.20)
    ap.add_argument("--reclaim-n", type=int, default=2)
    args = ap.parse_args(argv)
    bars = _bt.load_bars(args.cache)
    out = backtest_coach(bars, {"rr_min": args.rr_min, "arm_dist": args.arm_dist,
                                "confirm_closes": args.reclaim_n})
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
