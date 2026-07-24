"""scanner-families goal — five candidate scanner strategies on frozen hourly.

Freeze:   python -m research.scanner_families --freeze
Measure:  python -m research.scanner_families [--h 1|2|3|4|5]

Definitions + pre-registered bars: claudedocs/goals/scanner-families/.
Research-only (ADR-010). Shared machinery: hourly fractal-pivot zone
clusters, ATR, first-touch/stop-first exits, 40-bar cap.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vantage_server.ict import atr as _atr, pivots as _pivots  # noqa: E402

BD = Path(__file__).resolve().parents[1] / "backtest_data"
CACHE = BD / "scanner_univ_hourly.json"
MACRO = BD / "macro_daily_3y.json"
N_SYMS = 60
ZONE_TOL = 0.004          # pivots within 0.4% cluster into one zone
BREAK_ATR = 0.10          # close-through depth
RECLAIM_CLOSES = 3
STOP_ATR = 0.5
TGT_MAX_ATR = 5.0
TIME_CAP = 40             # hourly bars ≈ 5 sessions


def freeze() -> None:
    import yfinance as yf
    from vantage_server.store import Store  # noqa: F401 (env parity)
    import sqlite3, urllib.request  # noqa: F401
    universe = json.loads(_universe_json())[:N_SYMS]
    out = {"frozen_at": _dt.datetime.now(_dt.timezone.utc).isoformat(), "bars": {}}
    for s in universe:
        try:
            df = yf.Ticker(s).history(period="730d", interval="1h")
            idx = df.index.tz_convert("America/New_York")
            keep = (idx.hour >= 9) & (idx.hour <= 15)
            df = df[keep]
            if len(df) < 500:
                print(f"skip {s}: {len(df)} bars"); continue
            out["bars"][s] = {
                "ts": [t.isoformat() for t in df.index.tz_convert("America/New_York")],
                "open": [round(float(v), 4) for v in df["Open"]],
                "high": [round(float(v), 4) for v in df["High"]],
                "low": [round(float(v), 4) for v in df["Low"]],
                "close": [round(float(v), 4) for v in df["Close"]],
            }
        except Exception as e:  # noqa: BLE001
            print(f"skip {s}: {e}")
    # ^VIX3M add-on for the H4 backwardation gate
    try:
        df = yf.Ticker("^VIX3M").history(period="3y", interval="1d")
        out["vix3m"] = {str(t)[:10]: round(float(v), 2) for t, v in zip(df.index, df["Close"])}
    except Exception as e:  # noqa: BLE001
        print("vix3m:", e)
    CACHE.write_text(json.dumps(out))
    print(f"froze {len(out['bars'])} symbols -> {CACHE}")


def _universe_json() -> str:
    # the stored default universe (qqq100+spy100) — read via docker'd db is not
    # reachable from the host venv, so the list is vendored here verbatim.
    return json.dumps([
        "NVDA","AAPL","MSFT","AMZN","GOOGL","GOOG","AVGO","META","TSLA","MU",
        "WMT","AMD","ASML","INTC","AMAT","CSCO","COST","LRCX","PLTR","NFLX",
        "PANW","KLAC","TXN","LIN","TMUS","CRWD","AMGN","PEP","ADI","QCOM",
        "GILD","MRVL","STX","SHOP","WDC","BKNG","ISRG","SBUX","PDD","VRTX",
        "FTNT","ADP","CDNS","MAR","MNST","CSX","MELI","ADBE","DDOG","CEG",
        "ABNB","CMCSA","CTAS","DASH","INTU","SNPS","MDLZ","ROST","AEP","HON"])


def _load():
    return json.loads(CACHE.read_text())


def _zones(hi, lo):
    """Durable-zone proxy: >=2 hourly 3/3 pivots within ZONE_TOL -> level."""
    ph, pl = _pivots(hi, lo, n=3)
    pts = sorted([(i, p) for i, p in ph.items()] + [(i, p) for i, p in pl.items()],
                 key=lambda x: x[1])
    zones, cur = [], []
    for i, p in pts:
        if cur and abs(p - cur[-1][1]) / cur[-1][1] > ZONE_TOL:
            if len(cur) >= 2:
                zones.append({"level": sum(x[1] for x in cur) / len(cur),
                              "born_i": max(x[0] for x in cur) + 3})
            cur = []
        cur.append((i, p))
    if len(cur) >= 2:
        zones.append({"level": sum(x[1] for x in cur) / len(cur),
                      "born_i": max(x[0] for x in cur) + 3})
    return zones


def _simulate(hi, lo, cl, entry_i, side, entry, stop, tgt):
    """First-touch, stop-first on ambiguous bars, TIME_CAP mark-to-close.
    Returns pnl_pct."""
    end = min(len(cl) - 1, entry_i + TIME_CAP)
    for j in range(entry_i + 1, end + 1):
        hit_stop = lo[j] <= stop if side > 0 else hi[j] >= stop
        hit_tgt = hi[j] >= tgt if side > 0 else lo[j] <= tgt
        if hit_stop:
            return (stop - entry) / entry * 100 * side
        if hit_tgt:
            return (tgt - entry) / entry * 100 * side
    return (cl[end] - entry) / entry * 100 * side


def h1_signals(d):
    """Reclaim/role-flip entries across the universe.
    Yields (sym, ts, entry_i, side, pnl_pct)."""
    out = []
    for sym, b in d["bars"].items():
        hi, lo, cl = b["high"], b["low"], b["close"]
        zones = _zones(hi, lo)
        levels = sorted(z["level"] for z in zones)
        for z in zones:
            L = z["level"]
            i = z["born_i"]
            n = len(cl)
            # find the BREAK (first close through by >= BREAK_ATR x ATR) with the
            # HELD-FIRST guard: the level must have been respected from the other
            # side before the break counts (a pivot cluster sitting beyond flat
            # price otherwise reads as perpetually broken — degenerate reclaims).
            bi = bside = None
            seen_above = seen_below = False
            for j in range(i, n):
                a = _atr(hi, lo, cl, j)
                if a <= 0:
                    continue
                if cl[j] > L + BREAK_ATR * a:
                    if seen_below:
                        bi, bside = j, +1; break      # held as resistance, broke UP
                    seen_above = True
                elif cl[j] < L - BREAK_ATR * a:
                    if seen_above:
                        bi, bside = j, -1; break      # held as support, broke DOWN
                    seen_below = True
            if bi is None:
                continue
            # reclaim: RECLAIM_CLOSES consecutive closes back through L
            streak = 0
            for j in range(bi + 1, min(n, bi + 200)):
                back = cl[j] < L if bside > 0 else cl[j] > L
                streak = streak + 1 if back else 0
                if streak >= RECLAIM_CLOSES:
                    side = -bside                      # trade the reclaim direction
                    entry = cl[j]
                    a = _atr(hi, lo, cl, j)
                    stop = L + STOP_ATR * a * bside
                    cands = [p for p in levels
                             if (p - entry) * side > 0 and abs(p - entry) <= TGT_MAX_ATR * a
                             and abs(p - L) / L > ZONE_TOL]
                    if not cands or a <= 0:
                        break
                    tgt = min(cands, key=lambda p: abs(p - entry))
                    pnl = _simulate(hi, lo, cl, j, side, entry, stop, tgt)
                    out.append((sym, b["ts"][j], j, side, pnl))
                    break
    return out


def _report(name, pnls, bar_pf=1.3):
    n = len(pnls)
    if not n:
        print(f"{name}: n=0"); return
    w = [p for p in pnls if p > 0]; l = [p for p in pnls if p <= 0]
    gw, gl = sum(w), abs(sum(l)) or 1e-9
    print(f"{name}: n={n} WR={len(w)/n:.3f} PF={gw/gl:.3f} net={sum(pnls):+.1f}% "
          f"avgW={gw/len(w):.2f} avgL={-gl/len(l):.2f}" if w and l else f"{name}: n={n} degenerate")


def h1(d):
    sig = h1_signals(d)
    pnls = [s[4] for s in sig]
    _report("H1 reclaim/role-flip", pnls)
    mid = sorted(s[1] for s in sig)[len(sig) // 2] if sig else None
    if mid:
        _report("  half A", [s[4] for s in sig if s[1] <= mid])
        _report("  half B", [s[4] for s in sig if s[1] > mid])
    by_side = {1: [s[4] for s in sig if s[3] > 0], -1: [s[4] for s in sig if s[3] < 0]}
    _report("  longs ", by_side[1]); _report("  shorts", by_side[-1])
    return sig


def h2(d):
    cont = 0; tot = 0; pnls = []
    for sym, b in d["bars"].items():
        ts, op, hi, lo, cl = b["ts"], b["open"], b["high"], b["low"], b["close"]
        days = {}
        for i, t in enumerate(ts):
            days.setdefault(t[:10], []).append(i)
        dl = sorted(days)
        for k in range(1, len(dl)):
            idxs = days[dl[k]]
            prev_close = cl[days[dl[k - 1]][-1]]
            o = op[idxs[0]]
            gap = (o / prev_close - 1) * 100
            if abs(gap) < 1.5:
                continue
            tot += 1
            day_close = cl[idxs[-1]]
            side = 1 if gap > 0 else -1
            if (day_close - o) * side > 0:
                cont += 1
            # trade: first hourly close still beyond prior close -> ride to day close
            e_i = idxs[0]
            if (cl[e_i] - prev_close) * side > 0:
                pnls.append((day_close - cl[e_i]) / cl[e_i] * 100 * side)
    print(f"H2 gap-continuation: gaps={tot} continuation-rate={cont/tot:.3f}" if tot else "H2: none")
    _report("  trade (1st-hour entry -> day close)", pnls)


def h3(d, perms=300):
    rng = random.Random(7)
    ratios = []
    all_expansion = []
    for sym, b in d["bars"].items():
        hi, lo, cl = b["high"], b["low"], b["close"]
        ts = b["ts"]
        n = len(cl)
        tr = [max(hi[i] - lo[i], abs(hi[i] - cl[i - 1]), abs(lo[i] - cl[i - 1])) / cl[i - 1]
              for i in range(1, n)]
        win = 30; look = 360; fwd = 18   # ~3 sessions forward
        base_fwd = []
        comp_fwd = []
        for i in range(look, n - 1 - fwd):
            cur = sum(tr[i - win:i])
            hist = [sum(tr[j - win:j]) for j in range(look, i, win)]
            if len(hist) < 6:
                continue
            f = sum(tr[i:i + fwd])
            base_fwd.append(f)
            if cur <= sorted(hist)[max(0, len(hist) // 5 - 1)]:
                comp_fwd.append(f)
        if len(comp_fwd) >= 3 and base_fwd:
            ratios.append(sum(comp_fwd) / len(comp_fwd) / (sum(base_fwd) / len(base_fwd)))
            all_expansion.append((len(comp_fwd), ratios[-1]))
    if ratios:
        m = sum(ratios) / len(ratios)
        n_ev = sum(x[0] for x in all_expansion)
        print(f"H3 compression->expansion: symbols={len(ratios)} events={n_ev} "
              f"mean fwd-range ratio={m:.3f}x (per-symbol median "
              f"{sorted(ratios)[len(ratios)//2]:.3f}x)")


def h4(d, sig):
    macro = json.loads(MACRO.read_text())["daily"]
    vix = {macro['^VIX']['ts'][i]: macro['^VIX']['close'][i]
           for i in range(len(macro['^VIX']['ts']))}
    vix3m = d.get("vix3m") or {}
    backw = {t for t, v in vix.items() if t in vix3m and v > vix3m[t]}
    # universe breadth: % of symbols above their own 50-day (daily closes from hourly)
    daily = {}
    for sym, b in d["bars"].items():
        dd = {}
        for t, c in zip(b["ts"], b["close"]):
            dd[t[:10]] = c
        daily[sym] = dd
    days = sorted(set().union(*[set(v) for v in daily.values()]))
    breadth = {}
    for i, t in enumerate(days):
        above = tot = 0
        for sym, dd in daily.items():
            hist = [dd[x] for x in days[max(0, i - 50):i + 1] if x in dd]
            if len(hist) < 30 or t not in dd:
                continue
            tot += 1
            if dd[t] > sum(hist) / len(hist):
                above += 1
        if tot >= 30:
            breadth[t] = above / tot * 100
    low_b = {t for t, v in breadth.items() if v < 40}
    for name, gate in (("backwardation", backw), ("breadth<40%", low_b)):
        ins = [s[4] for s in sig if s[1][:10] in gate]
        outs = [s[4] for s in sig if s[1][:10] not in gate]
        print(f"H4 gate {name}: gated n={len(ins)} vs rest n={len(outs)}")
        _report(f"  gated {name}", ins); _report("  ungated", outs)


def h5(d, sig):
    # RS proxy: entry symbol's trailing 20-session return in the universe top quartile
    daily = {}
    for sym, b in d["bars"].items():
        dd = {}
        for t, c in zip(b["ts"], b["close"]):
            dd[t[:10]] = c
        daily[sym] = dd
    days = sorted(set().union(*[set(v) for v in daily.values()]))
    day_ix = {t: i for i, t in enumerate(days)}
    def rs_rank(sym, day):
        i = day_ix.get(day)
        if i is None or i < 21:
            return None
        rets = {}
        for s2, dd in daily.items():
            a, z = days[i - 20], day
            if a in dd and z in dd and dd[a]:
                rets[s2] = dd[z] / dd[a] - 1
        if sym not in rets or len(rets) < 20:
            return None
        rank = sorted(rets.values()).index(rets[sym]) / (len(rets) - 1)
        return rank
    longs = [s for s in sig if s[3] > 0]
    filt = []
    for s in longs:
        r = rs_rank(s[0], s[1][:10])
        if r is not None and r >= 0.75:
            filt.append(s)
    _report("H5 baseline (H1 longs)", [s[4] for s in longs])
    _report("H5 RS-filtered longs  ", [s[4] for s in filt])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze", action="store_true")
    ap.add_argument("--h", type=int, default=0)
    a = ap.parse_args(argv)
    if a.freeze:
        freeze(); return 0
    d = _load()
    sig = None
    if a.h in (0, 1, 4, 5):
        sig = h1(d)
    if a.h in (0, 2):
        h2(d)
    if a.h in (0, 3):
        h3(d)
    if a.h in (0, 4) and sig is not None:
        h4(d, sig)
    if a.h in (0, 5) and sig is not None:
        h5(d, sig)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# ── wave 2: popular daily strategies (H6–H9) ─────────────────────────────────

def _daily(d):
    """Per-symbol daily OHLC derived from the hourly cache."""
    out = {}
    for sym, b in d["bars"].items():
        ts, hi, lo, cl = b["ts"], b["high"], b["low"], b["close"]
        days = {}
        for i, t in enumerate(ts):
            days.setdefault(t[:10], []).append(i)
        dl = sorted(days)
        out[sym] = {
            "ts": dl,
            "high": [max(hi[i] for i in days[t]) for t in dl],
            "low": [min(lo[i] for i in days[t]) for t in dl],
            "close": [cl[days[t][-1]] for t in dl],
        }
    return out


def _sma_at(cl, i, n):
    return sum(cl[i - n + 1:i + 1]) / n if i >= n - 1 else None


def _rsi2(cl, i):
    if i < 3:
        return None
    gains = losses = 0.0
    for k in (i - 1, i):
        ch = cl[k] - cl[k - 1]
        gains += max(ch, 0); losses += max(-ch, 0)
    if losses == 0:
        return 100.0
    rs = (gains / 2) / (losses / 2)
    return 100 - 100 / (1 + rs)


def _atr_d(hi, lo, cl, i, n=14):
    if i < n:
        return None
    trs = [max(hi[k] - lo[k], abs(hi[k] - cl[k - 1]), abs(lo[k] - cl[k - 1]))
           for k in range(i - n + 1, i + 1)]
    return sum(trs) / n


def wave2(d):
    daily = _daily(d)
    h6, h7, h8, h9 = [], [], [], []
    for sym, b in daily.items():
        hi, lo, cl, ts = b["high"], b["low"], b["close"], b["ts"]
        n = len(cl)
        in_pos_until = {"h6": -1, "h7": -1, "h8": -1, "h9": -1}
        for i in range(200, n - 1):
            ma200 = _sma_at(cl, i, 200); ma50 = _sma_at(cl, i, 50)
            ma20 = _sma_at(cl, i, 20)
            if ma200 is None:
                continue
            # H6 RSI(2) < 10 in uptrend → exit close > 5MA or 5 sessions
            if i > in_pos_until["h6"] and cl[i] > ma200 and (_rsi2(cl, i) or 99) < 10:
                exit_i = min(i + 5, n - 1)
                for j in range(i + 1, min(i + 6, n)):
                    m5 = _sma_at(cl, j, 5)
                    if m5 and cl[j] > m5:
                        exit_i = j; break
                h6.append((ts[i], (cl[exit_i] / cl[i] - 1) * 100))
                in_pos_until["h6"] = exit_i
            # H7 golden-cross pullback → 10 sessions or −2 ATR stop
            a = _atr_d(hi, lo, cl, i)
            if (i > in_pos_until["h7"] and ma50 and ma20 and a
                    and ma50 > ma200 and cl[i] <= ma20):
                stop = cl[i] - 2 * a
                exit_i = min(i + 10, n - 1); px = cl[exit_i]
                for j in range(i + 1, min(i + 11, n)):
                    if cl[j] < stop:
                        exit_i, px = j, cl[j]; break
                h7.append((ts[i], (px / cl[i] - 1) * 100))
                in_pos_until["h7"] = exit_i
            # H8 Donchian 55 breakout → exit close < prior 20-day low
            if i > in_pos_until["h8"] and i >= 55 and cl[i] > max(hi[i - 55:i]):
                exit_i = n - 1
                for j in range(i + 1, n):
                    if cl[j] < min(lo[j - 20:j]):
                        exit_i = j; break
                h8.append((ts[i], (cl[exit_i] / cl[i] - 1) * 100))
                in_pos_until["h8"] = exit_i
            # H9 −4% day in uptrend → hold 5 sessions
            if (i > in_pos_until["h9"] and cl[i] > ma200
                    and (cl[i] / cl[i - 1] - 1) * 100 <= -4.0):
                exit_i = min(i + 5, n - 1)
                h9.append((ts[i], (cl[exit_i] / cl[i] - 1) * 100))
                in_pos_until["h9"] = exit_i
    for name, rows in (("H6 RSI2-MR", h6), ("H7 GC-pullback", h7),
                       ("H8 Donchian55", h8), ("H9 big-dip", h9)):
        pnls = [p for _, p in rows]
        _report(name, pnls)
        if rows:
            mid = sorted(t for t, _ in rows)[len(rows) // 2]
            _report("   half A", [p for t, p in rows if t <= mid])
            _report("   half B", [p for t, p in rows if t > mid])
