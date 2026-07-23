"""context-forecast-edge goal — late-day unwind (H1) + intermarket direction (H2).

Freeze:   python -m research.context_edge --freeze
Measure:  python -m research.context_edge [--h1] [--h2]

Research-only (ADR-010): yfinance once for the freeze, then frozen JSON only.
Predictions pre-registered in claudedocs/goals/context-forecast-edge/log.md.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import random
from pathlib import Path

BD = Path(__file__).resolve().parents[1] / "backtest_data"
MACRO = BD / "macro_daily_3y.json"
SPY5 = BD / "spy_5m_60d.json"
ES = BD / "es_hourly_730d.json"
MACRO_SYMS = ["CL=F", "DX-Y.NYB", "^TNX", "HYG", "GLD", "^GSPC", "^VIX"]


def freeze() -> None:
    import yfinance as yf
    out = {"frozen_at": _dt.datetime.now(_dt.timezone.utc).isoformat(), "daily": {}}
    for s in MACRO_SYMS:
        df = yf.Ticker(s).history(period="3y", interval="1d")
        out["daily"][s] = {
            "ts": [str(t)[:10] for t in df.index],
            "open": [round(float(v), 4) for v in df["Open"]],
            "high": [round(float(v), 4) for v in df["High"]],
            "low": [round(float(v), 4) for v in df["Low"]],
            "close": [round(float(v), 4) for v in df["Close"]],
        }
        print(f"froze {s}: {len(df)} days")
    MACRO.write_text(json.dumps(out))
    df = yf.Ticker("SPY").history(period="60d", interval="5m")
    idx = df.index.tz_convert("America/New_York")
    keep = (idx.hour * 60 + idx.minute >= 570) & (idx.hour * 60 + idx.minute < 960)
    df = df[keep]
    SPY5.write_text(json.dumps({
        "frozen_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "ts": [t.isoformat() for t in df.index.tz_convert("America/New_York")],
        "high": [round(float(v), 4) for v in df["High"]],
        "low": [round(float(v), 4) for v in df["Low"]],
        "close": [round(float(v), 4) for v in df["Close"]],
    }))
    print(f"froze SPY 5m: {len(df)} bars")


def _sessions_5m(d):
    by = {}
    for i, t in enumerate(d["ts"]):
        by.setdefault(t[:10], []).append(i)
    return by


def h1() -> None:
    d = json.loads(SPY5.read_text())
    cl = d["close"]
    by = _sessions_5m(d)
    days = sorted(by)
    rows = []
    for k, day in enumerate(days):
        if k == 0:
            continue
        prev_close = cl[by[days[k - 1]][-1]]
        idxs = by[day]
        bars = [(d["ts"][i][11:16], cl[i]) for i in idxs]
        at1545 = next((c for t, c in reversed(bars) if t <= "15:45"), None)
        close = bars[-1][1]
        if at1545 is None or prev_close is None:
            continue
        day_ret = (at1545 / prev_close - 1) * 100
        last15 = (close / at1545 - 1) * 100
        rows.append((day, day_ret, last15))

    def agg(sel, name):
        xs = [l for _, r, l in rows if sel(r)]
        n = len(xs)
        if not n:
            print(f"  {name}: n=0"); return
        up = sum(1 for x in xs if x > 0)
        print(f"  {name}: n={n} mean={sum(xs)/n:+.3f}% up-rate={up/n:.2f} "
              f"| {sorted(round(x,2) for x in xs)}")

    print("H1a — SPY last-15m (15:45→16:00) by day state at 15:45:")
    agg(lambda r: r <= -1.0, "down ≥1%  ")
    agg(lambda r: r >= 1.0, "up ≥1%    ")
    agg(lambda r: abs(r) < 1.0, "quiet     ")

    es = json.loads(ES.read_text())["bars"]   # ET-stamped hourly Globex bars
    ets, ecl = es["ts"], es["close"]
    eby = {}
    for i, t in enumerate(ets):
        # RTH hours in ET stamps: 09:00/09:30 .. 15:00 buckets; take 09–15 window
        if "09:00" <= t[11:16] <= "15:59":
            eby.setdefault(t[:10], []).append(i)
    edays = sorted(eby)
    stats = {"down": [], "up": [], "quiet": []}
    for k in range(1, len(edays)):
        idxs = eby[edays[k]]
        if len(idxs) < 4:
            continue
        prev_day = eby[edays[k - 1]]
        prev = ecl[prev_day[-1]]
        at_last_hour = ecl[idxs[-2]]      # entering the final RTH hour
        close = ecl[idxs[-1]]             # after it
        r = (at_last_hour / prev - 1) * 100
        lh = (close / at_last_hour - 1) * 100
        key = "down" if r <= -1 else "up" if r >= 1 else "quiet"
        stats[key].append(lh)
    print("H1b — ES last RTH hour by day state entering it:")
    for k, xs in stats.items():
        if xs:
            up = sum(1 for x in xs if x > 0)
            print(f"  {k:6}: n={len(xs)} mean={sum(xs)/len(xs):+.3f}% up-rate={up/len(xs):.2f}")


def h2(perms: int = 500) -> None:
    d = json.loads(MACRO.read_text())["daily"]
    spx = d["^GSPC"]
    sdays = {t: i for i, t in enumerate(spx["ts"])}

    def rets(sym):
        s = d[sym]
        return {s["ts"][i]: (s["close"][i] / s["close"][i - 1] - 1) * 100
                for i in range(1, len(s["ts"]))}

    spx_r = rets("^GSPC")
    spx_tr = {}
    for i in range(1, len(spx["ts"])):
        t = spx["ts"][i]
        spx_tr[t] = (spx["high"][i] - spx["low"][i]) / spx["close"][i - 1] * 100
    all_days = sorted(set(spx_r))
    base_tr = sum(spx_tr[t] for t in all_days if t in spx_tr) / len(all_days)
    rng = random.Random(7)

    for sym, big in (("CL=F", 3.0), ("DX-Y.NYB", 0.8), ("^TNX", 4.0), ("HYG", 0.7)):
        mr = rets(sym)
        trig = [t for t in all_days[:-1] if t in mr and abs(mr[t]) >= big]
        nxt = {all_days[i]: all_days[i + 1] for i in range(len(all_days) - 1)}
        pairs = [(t, nxt[t]) for t in trig if nxt.get(t) in spx_r]
        if not pairs:
            print(f"{sym}: no trigger days"); continue
        # direction: "driver up → SPX down next day" (and mirror)
        agree = sum(1 for t, n in pairs if (mr[t] > 0) == (spx_r[n] < 0))
        # range echo
        tr_ratio = (sum(spx_tr[n] for _, n in pairs if n in spx_tr) / len(pairs)) / base_tr
        # shuffle control for the range ratio
        beats = 0
        for _ in range(perms):
            samp = rng.sample(all_days[:-1], len(pairs))
            r = (sum(spx_tr[nxt[t]] for t in samp if nxt.get(t) in spx_tr) / len(samp)) / base_tr
            if r >= tr_ratio:
                beats += 1
        # sign stability: rolling 60d corr sign flips
        flips, last_sign = 0, 0
        days_both = [t for t in all_days if t in mr]
        for i in range(60, len(days_both)):
            w = days_both[i - 60:i]
            mx = [mr[t] for t in w]; sx = [spx_r[t] for t in w]
            mm, sm = sum(mx) / 60, sum(sx) / 60
            cov = sum((a - mm) * (b - sm) for a, b in zip(mx, sx))
            sign = 1 if cov > 0 else -1
            if last_sign and sign != last_sign:
                flips += 1
            last_sign = sign
        print(f"{sym}: n_trigger={len(pairs)} | direction-rule agreement "
              f"{agree}/{len(pairs)}={agree/len(pairs):.2f} | next-day range ratio "
              f"{tr_ratio:.2f}x (shuffle p={beats/perms:.3f}) | 60d-corr sign flips (3y): {flips}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--freeze", action="store_true")
    ap.add_argument("--h1", action="store_true")
    ap.add_argument("--h2", action="store_true")
    a = ap.parse_args(argv)
    if a.freeze:
        freeze(); return 0
    if a.h1 or not a.h2:
        h1()
    if a.h2 or not a.h1:
        h2()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
