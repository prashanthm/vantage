"""Offline backtest harness for the playbook paper strategies (goal loop tooling).

Replays each historical session as if it were "today": the scaffold (chart
dimensions, confluence zones, durable-level memory) is rebuilt from bars STRICTLY
BEFORE the session — exactly the information last night's playbook would have had
— then the real ``paper.build_tickets`` generates the tickets and this module
simulates resting-limit fills against the session's proxy bars.

Honest limits, fixed for the whole experiment loop so runs stay comparable:
  * GEX cannot be reconstructed historically (no archived chains) — scaffolds run
    on the chart-derived dimensions only (``gex.available = False``).
  * Fills are conservative: a bar that touches both entry and stop counts as a
    stop-out; a target is never credited on the fill bar itself.
  * Unfilled tickets are excluded from win rate (no trade happened).
  * P&L is measured in % of entry so SPY/QQQ/IWM aggregate fairly.

The bar dataset is FROZEN to a JSON cache (``--freeze``) so every experiment in
the loop measures against the identical tape. Research tooling only: reads bars,
writes nothing to the store, places no orders (ADR-010).

CLI:
  python -m vantage_server.backtest --freeze --cache backtest_data/bars.json
  python -m vantage_server.backtest --cache backtest_data/bars.json [--params '{...}']
"""
from __future__ import annotations

import argparse
import contextlib
import datetime as _dt
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from . import paper
from . import spx_playbook as sp
from . import underlyings as _u

ET = ZoneInfo("America/New_York")
EXIT_OK = 0
EXIT_USER_ERROR = 2

#: sessions of history a replayed day needs before it counts (the 10-session
#: recent window + a few sessions of durable-level accrual).
WARMUP_SESSIONS = 12

#: bar symbols the frozen cache carries (^GSPC prices SPX; SPY is its proxy +
#: volume donor; the ETFs are self-contained).
CACHE_SYMBOLS = ["^GSPC", "SPY", "QQQ", "IWM"]

#: knobs an experiment may vary. ``stop_pad_pct`` / ``suppress_counter_trend``
#: patch the prod constants in ``paper`` for the run (prod code stays the single
#: source of truth for ticket math); the rest are harness-level ticket filters.
DEFAULT_PARAMS = {
    "stop_pad_pct": paper.STOP_PAD_PCT,
    "suppress_counter_trend": paper.SUPPRESS_COUNTER_TREND,
    "include_breaks": True,        # C/D break-retest tickets on/off
    "include_tests": True,         # A/B test tickets on/off
    "rr_min": None,                # skip tickets with reward:risk below this
    "exclude_freshness": [],       # e.g. ["weak"] — skip zones by freshness tag
    "exclude_counter_trend": False,  # harness-side counter-trend skip
    "min_strength": None,          # confluence dimensions required (zones have >=2)
    "max_per_side": None,          # cap test tickets per side (prod takes 2)
    "target_r_multiple": None,     # override target to entry +/- R*risk
    "entry_mode": "touch",         # "touch" | "reclaim" (close back through level)
    "stop_atr_mult": None,         # stop = entry -/+ mult*ATR(14,15m) when set
    "time_stop_bars": None,        # exit at close N bars after fill
    "skip_open_bars": 0,           # tickets not actionable in the first N bars
    "direction_gate": None,        # "structure": uptrend->longs, downtrend->shorts
    "underlyings": ["SPX", "QQQ", "IWM"],
}


# ── frozen bar cache ──────────────────────────────────────────────────────────

def freeze_bars(cache_path: str) -> dict:
    """Fetch 15m RTH bars for every cache symbol and write them to ``cache_path``
    as plain JSON (ISO timestamps + OHLCV columns). Returns a per-symbol row
    count. The ONLY network-touching entry point in this module."""
    out: dict[str, dict] = {}
    counts: dict[str, int] = {}
    for sym in CACHE_SYMBOLS:
        df = sp._fetch_15m(sym)
        if df is None or getattr(df, "empty", True):
            raise RuntimeError(f"no bars for {sym} — cannot freeze")
        out[sym] = {
            "ts": [t.isoformat() for t in df.index],
            "open": [round(float(v), 4) for v in df["Open"]],
            "high": [round(float(v), 4) for v in df["High"]],
            "low": [round(float(v), 4) for v in df["Low"]],
            "close": [round(float(v), 4) for v in df["Close"]],
            "volume": [float(v) for v in df.get("Volume", [0.0] * len(df))],
        }
        counts[sym] = len(df)
    payload = {"frozen_at": _dt.datetime.now(ET).isoformat(), "bars": out}
    p = Path(cache_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload))
    return counts


def load_bars(cache_path: str) -> dict:
    """Load the frozen cache back into per-symbol pandas DataFrames (ET index)."""
    import pandas as pd

    raw = json.loads(Path(cache_path).read_text())
    out = {}
    for sym, cols in raw["bars"].items():
        idx = pd.DatetimeIndex([pd.Timestamp(t) for t in cols["ts"]])
        df = pd.DataFrame({"Open": cols["open"], "High": cols["high"],
                           "Low": cols["low"], "Close": cols["close"],
                           "Volume": cols["volume"]}, index=idx)
        out[sym] = df
    return out


# ── scaffold reconstruction (as-of a historical evening) ─────────────────────

def _sessions(df) -> list:
    return sorted({t.date() for t in df.index})


def _day_slice(df, day):
    return df[[t.date() == day for t in df.index]]


def _upto(df, day):
    """Bars for sessions <= day (the information set after day's close)."""
    return df[[t.date() <= day for t in df.index]]


def scaffold_asof(bars, proxy_bars, day, cfg, history_rows: list[dict]) -> dict | None:
    """The playbook scaffold as it would have been built on the EVENING of
    ``day`` (for trading the next session): chart dims over the trailing window
    ending at ``day``, confluence, durable levels from ``history_rows`` (all
    sessions <= day). GEX is unavailable historically."""
    window = _upto(bars, day)
    if window is None or window.empty:
        return None
    if cfg["self_proxy"]:
        volsrc = window
    else:
        volsrc = _upto(proxy_bars, day)
    vol_by_ts = {t: float(v) for t, v in zip(volsrc.index, volsrc["Volume"])}
    scale = {"round_step": cfg["round_step"], "cluster_tol": cfg["cluster_tol"]}
    chart = sp._chart_dimensions(window, vol_by_ts, scale=scale)
    if not chart.get("available"):
        return None
    gex = {"available": False}
    spot = chart.get("last")
    ladder = sp.build_level_ladder(gex, chart, scale=scale)
    confluence = sp.build_confluence(ladder, spot)
    durable = sp.build_durable_levels(history_rows, spot)
    return {
        "regime": {"spot": spot, "gamma": None},
        "chart": chart,
        "confluence": confluence,
        "durable": durable,
    }


def history_rows_for(chart: dict, day, day_bars) -> list[dict]:
    """One session's level rows in the ``level_history`` shape that
    ``build_durable_levels`` consumes (session + day OHLC attached)."""
    rows = sp.session_levels_for_history(chart, {"available": False})
    dh = dl = dc = None
    if day_bars is not None and not day_bars.empty:
        dh = round(float(day_bars["High"].max()), 2)
        dl = round(float(day_bars["Low"].min()), 2)
        dc = round(float(day_bars["Close"].iloc[-1]), 2)
    for r in rows:
        r["session"] = day.isoformat()
        r["day_high"], r["day_low"], r["day_close"] = dh, dl, dc
    return rows


# ── fill simulation ──────────────────────────────────────────────────────────

def simulate_fill(ticket: dict, day_bars, start_idx: int = 0,
                  entry_mode: str = "touch",
                  time_stop_bars: int | None = None) -> dict | None:
    """Simulate a resting-limit ticket against a session's proxy bars, starting
    at ``start_idx`` (break tickets spawn mid-day). Conservative rules: a bar
    touching both entry and stop is a stop-out; a target is never credited on
    the fill bar. Unclosed fills mark-to-close at the last bar ("eod").

    ``entry_mode="reclaim"`` waits for confirmation instead of catching the
    knife: after price touches the level, the fill happens at the close of the
    first bar that closes back on the trade's side of the level (long: close
    above; short: close below). No reclaim by EOD = no trade. The reclaim bar
    itself cannot stop the trade (it closed on the right side by definition).

    ``time_stop_bars=N`` exits at the close N bars after the fill bar when
    neither target nor stop has hit (0DTE theta discipline).

    Returns ``{filled, entry, exit, reason, pnl_pct, fill_idx}`` or None when
    the ticket never fills."""
    side = ticket["side"]
    entry = ticket["spy_entry"]
    tgt = ticket.get("spy_target")
    stop = ticket.get("spy_stop")
    if entry is None or tgt is None or stop is None:
        return None
    direction = 1 if side == "long" else -1
    highs = list(day_bars["High"]); lows = list(day_bars["Low"])
    closes = list(day_bars["Close"])
    n = len(closes)
    fill_idx = None
    fill_px = entry
    fill_bar_can_stop = True
    if entry_mode == "reclaim":
        touched = False
        for i in range(start_idx, n):
            if not touched:
                touched = (lows[i] <= entry) if side == "long" else (highs[i] >= entry)
            if touched:
                reclaimed = (closes[i] > entry) if side == "long" else (closes[i] < entry)
                if reclaimed:
                    fill_idx, fill_px = i, closes[i]
                    fill_bar_can_stop = False   # bar already closed on our side
                    break
    else:
        for i in range(start_idx, n):
            if side == "long" and lows[i] <= entry:
                fill_idx = i; break
            if side == "short" and highs[i] >= entry:
                fill_idx = i; break
    if fill_idx is None:
        return None
    # fill bar: conservative — stop can trigger (touch mode), target cannot
    stopped_on_fill = fill_bar_can_stop and (
        (lows[fill_idx] <= stop) if side == "long" else (highs[fill_idx] >= stop))
    if stopped_on_fill:
        exit_px, reason = stop, "stop"
    else:
        exit_px = reason = None
        last_bar = n - 1
        if time_stop_bars is not None:
            last_bar = min(last_bar, fill_idx + time_stop_bars)
        for i in range(fill_idx + 1, last_bar + 1):
            hit_stop = (lows[i] <= stop) if side == "long" else (highs[i] >= stop)
            hit_tgt = (highs[i] >= tgt) if side == "long" else (lows[i] <= tgt)
            if hit_stop:                 # stop first on ambiguous bars
                exit_px, reason = stop, "stop"; break
            if hit_tgt:
                exit_px, reason = tgt, "target"; break
        if reason is None:
            exit_px = closes[last_bar]
            reason = "eod" if last_bar == n - 1 else "time"
    pnl_pct = (exit_px - fill_px) / fill_px * 100 * direction
    return {"filled": True, "entry": round(fill_px, 4), "exit": round(exit_px, 4),
            "reason": reason, "pnl_pct": round(pnl_pct, 4), "fill_idx": fill_idx}


# ── ticket generation for a replayed day ─────────────────────────────────────

@contextlib.contextmanager
def _patched(params: dict):
    """Apply the experiment's prod-constant overrides to ``paper`` for the run."""
    saved = (paper.STOP_PAD_PCT, paper.SUPPRESS_COUNTER_TREND)
    paper.STOP_PAD_PCT = float(params["stop_pad_pct"])
    paper.SUPPRESS_COUNTER_TREND = bool(params["suppress_counter_trend"])
    try:
        yield
    finally:
        paper.STOP_PAD_PCT, paper.SUPPRESS_COUNTER_TREND = saved


def _ticket_key(t: dict) -> tuple:
    return (t.get("setup"), t.get("side"), round(t.get("spx_level") or 0, 1))


def day_tickets(scaffold: dict, day_bars, ratio: float, underlying: str,
                params: dict) -> list[dict]:
    """All tickets a trader following the playbook would have had on this day.
    Test tickets exist from the open; break tickets spawn at the first bar whose
    cumulative session range satisfies the break condition (the same
    ``build_tickets`` logic, walked bar by bar). Each ticket carries
    ``start_idx`` — the bar it became actionable."""
    proxy_open = float(day_bars["Open"].iloc[0])
    highs = list(day_bars["High"]); lows = list(day_bars["Low"])
    closes = list(day_bars["Close"])
    ts = list(day_bars.index)
    seen: set[tuple] = set()
    out: list[dict] = []
    # bar 0: test tickets (session_range=() -> falsy, skips breaks + any fetch)
    base = paper.build_tickets(scaffold, proxy_open, ratio, session_range=(),
                               now_et=ts[0].to_pydatetime(), underlying=underlying)
    for t in base:
        if t.get("setup") == "test":
            t["start_idx"] = 0
            k = _ticket_key(t)
            if k not in seen:
                seen.add(k); out.append(t)
    # walk the session: break tickets appear when a zone first breaks
    if params["include_breaks"]:
        for i in range(len(closes)):
            rng = (min(lows[: i + 1]), max(highs[: i + 1]), closes[i])
            cur = paper.build_tickets(scaffold, closes[i], ratio, session_range=rng,
                                      now_et=ts[i].to_pydatetime(),
                                      underlying=underlying)
            for t in cur:
                if t.get("setup") != "break":
                    continue
                k = _ticket_key(t)
                if k not in seen:
                    seen.add(k)
                    t["start_idx"] = i + 1   # actionable from the NEXT bar
                    out.append(t)
    return out


def _atr(bars, period: int = 14) -> float | None:
    """ATR over the tail of ``bars`` (15m true range, simple mean)."""
    if bars is None or len(bars) < period + 1:
        return None
    highs = list(bars["High"])[-(period + 1):]
    lows = list(bars["Low"])[-(period + 1):]
    closes = list(bars["Close"])[-(period + 1):]
    trs = [max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]),
               abs(lows[i] - closes[i - 1])) for i in range(1, len(closes))]
    return sum(trs) / len(trs) if trs else None


def _apply_filters(tickets: list[dict], params: dict,
                   atr: float | None = None) -> list[dict]:
    """Harness-level experiment filters (candidate rules not yet in prod)."""
    out = []
    per_side: dict[str, int] = {}
    for t in tickets:
        if params["direction_gate"] == "structure":
            st = t.get("trend_state")
            if st == "uptrend" and t["side"] != "long":
                continue
            if st == "downtrend" and t["side"] != "short":
                continue
        if params["stop_atr_mult"] is not None and atr:
            sign = -1 if t["side"] == "long" else 1
            t = dict(t)
            t["spy_stop"] = round(t["spy_entry"] + sign * params["stop_atr_mult"] * atr, 4)
        if t.get("setup") == "test" and not params["include_tests"]:
            continue
        if params["exclude_counter_trend"] and t.get("counter_trend"):
            continue
        if params["exclude_freshness"] and t.get("freshness") in params["exclude_freshness"]:
            continue
        if params["rr_min"] is not None and (t.get("reward_risk") or 0) < params["rr_min"]:
            continue
        if params["min_strength"] is not None:
            strength = len(t.get("kinds") or [])
            if strength < params["min_strength"]:
                continue
        if params["max_per_side"] is not None and t.get("setup") == "test":
            n = per_side.get(t["side"], 0)
            if n >= params["max_per_side"]:
                continue
            per_side[t["side"]] = n + 1
        if params["target_r_multiple"] is not None:
            r = params["target_r_multiple"]
            risk = abs(t["spy_entry"] - t["spy_stop"])
            if risk > 0:
                sign = 1 if t["side"] == "long" else -1
                t = dict(t)
                t["spy_target"] = round(t["spy_entry"] + sign * r * risk, 2)
        out.append(t)
    return out


# ── the replay ───────────────────────────────────────────────────────────────

def run_backtest(bars_by_symbol: dict, params: dict | None = None) -> dict:
    """Replay every warm session for every configured underlying and score the
    trades. Deterministic given the frozen cache + params."""
    p = dict(DEFAULT_PARAMS)
    p.update(params or {})
    trades: list[dict] = []
    counts = {"sessions": 0, "tickets": 0, "no_fill": 0, "no_target": 0}
    with _patched(p):
        for key in p["underlyings"]:
            cfg = _u.get(key)
            bars = bars_by_symbol.get(cfg["bar_symbol"])
            proxy_bars = bars if cfg["self_proxy"] else bars_by_symbol.get(cfg["proxy_symbol"])
            if bars is None or proxy_bars is None:
                continue
            days = _sessions(bars)
            history: list[dict] = []
            for i, day in enumerate(days):
                day_bars = _day_slice(bars, day)
                # scaffold built on the EVENING of `day` trades day d+1
                if i + 1 < len(days) and i + 1 >= WARMUP_SESSIONS:
                    trade_day = days[i + 1]
                    scaffold = scaffold_asof(bars, proxy_bars, day, cfg, history)
                    pday = _day_slice(proxy_bars, trade_day)
                    if scaffold and scaffold["confluence"] and not pday.empty:
                        spot = scaffold["regime"]["spot"]
                        prior_proxy = float(_day_slice(proxy_bars, day)["Close"].iloc[-1]) \
                            if not _day_slice(proxy_bars, day).empty else None
                        ratio = 1.0 if cfg["self_proxy"] else (
                            (spot / prior_proxy) if (spot and prior_proxy) else 10.0)
                        tickets = day_tickets(scaffold, pday, ratio, key, p)
                        atr = _atr(_upto(proxy_bars, day)) if p["stop_atr_mult"] else None
                        tickets = _apply_filters(tickets, p, atr=atr)
                        counts["sessions"] += 1
                        for t in tickets:
                            counts["tickets"] += 1
                            if t.get("spy_target") is None:
                                counts["no_target"] += 1
                                continue
                            start = max(t.get("start_idx", 0), int(p["skip_open_bars"]))
                            res = simulate_fill(t, pday, start,
                                                entry_mode=p["entry_mode"],
                                                time_stop_bars=p["time_stop_bars"])
                            if res is None:
                                counts["no_fill"] += 1
                                continue
                            trades.append({
                                "day": trade_day.isoformat(), "underlying": key,
                                "setup": t["setup"], "side": t["side"],
                                "counter_trend": bool(t.get("counter_trend")),
                                "freshness": t.get("freshness"),
                                "rr": t.get("reward_risk"), **res,
                            })
                # then record `day` into history for future durable reads
                window = _upto(bars, day)
                volsrc = window if cfg["self_proxy"] else _upto(proxy_bars, day)
                vol_by_ts = {t: float(v) for t, v in zip(volsrc.index, volsrc["Volume"])}
                scale = {"round_step": cfg["round_step"], "cluster_tol": cfg["cluster_tol"]}
                chart_i = sp._chart_dimensions(window, vol_by_ts, scale=scale)
                if chart_i.get("available"):
                    history.extend(history_rows_for(chart_i, day, day_bars))
    return {"params": p, "counts": counts, "metrics": score(trades),
            "trades": trades}


def score(trades: list[dict]) -> dict:
    """Win rate + profit factor (in %-of-entry points) with breakdowns."""
    def _agg(rows: list[dict]) -> dict:
        n = len(rows)
        if not n:
            return {"n": 0}
        wins = [t for t in rows if t["pnl_pct"] > 0]
        losses = [t for t in rows if t["pnl_pct"] <= 0]
        gw = sum(t["pnl_pct"] for t in wins)
        gl = sum(t["pnl_pct"] for t in losses)
        by_reason: dict[str, int] = {}
        for t in rows:
            by_reason[t["reason"]] = by_reason.get(t["reason"], 0) + 1
        return {
            "n": n, "wins": len(wins), "losses": len(losses),
            "win_rate": round(len(wins) / n, 4),
            "profit_factor": round(gw / abs(gl), 3) if gl else None,
            "net_pct": round(gw + gl, 3),
            "avg_pct": round((gw + gl) / n, 4),
            "by_exit": by_reason,
        }
    out = {"overall": _agg(trades)}
    for dim in ("underlying", "setup", "side", "freshness"):
        groups: dict[str, list[dict]] = {}
        for t in trades:
            groups.setdefault(str(t.get(dim)), []).append(t)
        out[f"by_{dim}"] = {k: _agg(v) for k, v in sorted(groups.items())}
    ct = [t for t in trades if t["counter_trend"]]
    wt = [t for t in trades if not t["counter_trend"]]
    out["by_trend"] = {"counter": _agg(ct), "with": _agg(wt)}
    return out


# ============================================================ CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m vantage_server.backtest",
        description="Replay the playbook paper strategies against frozen 15m bars. "
                    "Research tooling — writes nothing, places no orders (ADR-010).")
    p.add_argument("--cache", required=True, help="path to the frozen bar cache JSON")
    p.add_argument("--freeze", action="store_true",
                   help="fetch fresh bars and (over)write the cache, then exit")
    p.add_argument("--params", help="JSON dict of experiment overrides")
    p.add_argument("--trades", action="store_true", help="also print per-trade rows")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.freeze:
        counts = freeze_bars(args.cache)
        print("frozen:", json.dumps(counts))
        return EXIT_OK
    if not Path(args.cache).exists():
        print(f"error: cache not found: {args.cache} (run --freeze first)",
              file=sys.stderr)
        return EXIT_USER_ERROR
    overrides = json.loads(args.params) if args.params else {}
    result = run_backtest(load_bars(args.cache), overrides)
    view = {k: v for k, v in result.items() if k != "trades"}
    print(json.dumps(view, indent=2))
    if args.trades:
        for t in result["trades"]:
            print(f"{t['day']} {t['underlying']:>3} {t['setup']:>5} {t['side']:>5} "
                  f"{t['reason']:>6} {t['pnl_pct']:+.3f}%")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
