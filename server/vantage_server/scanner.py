"""ICT Scanner — run the backtest-validated hourly setup detector across a UNIVERSE.

The A+ hourly setup detector (`ict_htf.htf_setup`, the confluence-stack /
displacement-FVG-reaction confirmed by the `ict-concepts-edge` goal) already runs
per-SPX inside the snapshot. This module runs the SAME detector across a universe of
tickers (top-10 holdings of SPY/QQQ/IWM) and returns a ranked scan the UI + an hourly
cron consume.

PURE + DETERMINISTIC: hourly bars in → tiered signals out. No LLM, no orders
(ADR-010). Pluggable: `SCANNERS` maps a scanner id to a per-symbol detector, so more
scanner types are a dict entry, not a rewrite.

Data: the detector needs only hourly OHLC (pure price), so it works on ANY ticker.
yfinance serves 60m bars directly (~2yr), stored in `intraday_bars` with
interval='60m'. htf_setup needs ≥32 hourly bars (~5 trading days).
"""
from __future__ import annotations

import datetime as _dt
import logging

from . import ict
from . import ict_htf as _htf

log = logging.getLogger("vantage.scanner")

#: the ETFs whose top-10 holdings form the default universe.
_UNIVERSE_ETFS = ("SPY", "QQQ", "IWM")

#: pinned fallback if yfinance holdings ever fail — a reasonable liquid set so the
#: scanner still runs. Logged as source='pinned-fallback' so the UI can flag it.
_PINNED_FALLBACK = [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "AVGO", "META", "TSLA", "GOOG", "MU",
    "NFLX", "COST", "PLTR", "AMD", "CSCO",
]

ET_OPEN = 9 * 60 + 30
ET_CLOSE = 16 * 60

#: a setup is "current" if it triggered within this many hourly bars of the latest
#: bar (~1 trading session of RTH hours). Older setups are stale — the detector
#: surfaces the most-recent-near one over the whole loaded series, so without this
#: gate a multi-day scan would show days-old signals as if live.
_FRESH_BARS = 7


# ── universe ─────────────────────────────────────────────────────────────────

def _etf_top_holdings(etf: str) -> list[str]:
    """The current top-10 holdings of an ETF via yfinance, or [] on failure."""
    try:
        import yfinance as yf
        fd = yf.Ticker(etf).funds_data
        h = fd.top_holdings
        return [str(s).upper() for s in list(h.index)[:10]]
    except Exception as e:  # noqa: BLE001 — a holdings failure degrades, never crashes
        log.warning("top_holdings failed for %s: %s", etf, e)
        return []


def resolve_universe(store, refresh: bool = False, set_key: str = "default") -> dict:
    """The deduped scanner universe. Cached in the store so a scan doesn't refetch
    holdings every run; ``refresh=True`` refetches. Returns
    {symbols, source, fetched_at, from_cache}."""
    if not refresh:
        cached = store.load_scanner_universe(set_key) if hasattr(store, "load_scanner_universe") else None
        if cached and cached.get("symbols"):
            return {**cached, "from_cache": True}
    # fetch live top-10 of each ETF, union + dedupe (preserve first-seen order),
    # drop the ETFs themselves (constituents only).
    seen: dict[str, None] = {}
    for etf in _UNIVERSE_ETFS:
        for sym in _etf_top_holdings(etf):
            if sym and sym not in _UNIVERSE_ETFS:
                seen.setdefault(sym, None)
    symbols = list(seen.keys())
    source = "holdings"
    if not symbols:
        symbols, source = list(_PINNED_FALLBACK), "pinned-fallback"
    if hasattr(store, "save_scanner_universe"):
        store.save_scanner_universe(symbols, source, set_key)
    row = store.load_scanner_universe(set_key) if hasattr(store, "load_scanner_universe") else None
    return {**(row or {"symbols": symbols, "source": source, "fetched_at": None}),
            "from_cache": False}


# ── hourly bar seeding ───────────────────────────────────────────────────────

def _rth_hourly(symbol: str, lookback_days: int = 10):
    """Recent RTH 60m bars for ``symbol`` as one compact OHLC dict, or None. Fetches
    the whole window in one call (yfinance serves 60m directly). RTH-filtered in ET."""
    try:
        import yfinance as yf
        from zoneinfo import ZoneInfo
        h = yf.Ticker(symbol).history(period=f"{max(5, lookback_days)}d", interval="60m")
        if h.empty:
            return None
        if h.index.tz is None:
            h.index = h.index.tz_localize("UTC")
        h.index = h.index.tz_convert(ZoneInfo("America/New_York"))
        mins = h.index.hour * 60 + h.index.minute
        h = h[(mins >= ET_OPEN) & (mins < ET_CLOSE)]
        if h.empty:
            return None
        return {
            "ts": [t.isoformat() for t in h.index],
            "open": [float(v) for v in h["Open"]],
            "high": [float(v) for v in h["High"]],
            "low": [float(v) for v in h["Low"]],
            "close": [float(v) for v in h["Close"]],
            "volume": [float(v) for v in h.get("Volume", h["Close"] * 0)],
        }
    except Exception as e:  # noqa: BLE001
        log.warning("60m fetch failed for %s: %s", symbol, e)
        return None


def seed_hourly(store, symbols: list[str], lookback_days: int = 10) -> dict:
    """Fetch + store recent 60m bars for each symbol (interval='60m'). Splits the
    fetched series by session-day so it slots into the (symbol, day, '60m') store
    key. Idempotent (INSERT OR REPLACE). Returns a per-symbol summary."""
    fetched = 0
    empty = 0
    for sym in symbols:
        ohlc = _rth_hourly(sym, lookback_days)
        if not ohlc or not ohlc.get("ts"):
            empty += 1
            continue
        # group bars by ET session-day
        by_day: dict[str, dict] = {}
        for i, t in enumerate(ohlc["ts"]):
            day = t[:10]
            d = by_day.setdefault(day, {"ts": [], "open": [], "high": [],
                                        "low": [], "close": [], "volume": []})
            d["ts"].append(t)
            for k in ("open", "high", "low", "close", "volume"):
                d[k].append(ohlc[k][i])
        for day, d in by_day.items():
            store.save_intraday_bars(sym, day, "60m", d)
        fetched += 1
    return {"symbols": len(symbols), "fetched": fetched, "no_data": empty}


def load_hourly_series(store, symbol: str, days: int = 15) -> dict | None:
    """Concatenate the stored 60m sessions for ``symbol`` (up to the latest) into one
    continuous OHLC series for the detector. Reuses load_intraday_bars_range."""
    latest = store.latest_intraday_day(symbol, "60m") if hasattr(store, "latest_intraday_day") else None
    if not latest:
        return None
    return store.load_intraday_bars_range(symbol, latest, "60m", days=days)


# ── the scan engine (pluggable) ──────────────────────────────────────────────

def _scan_ict_htf(store, symbol: str) -> dict | None:
    """Run the A+/B hourly ICT setup detector for one symbol from its stored 60m
    bars. Returns the htf_setup dict + {symbol, as_of, bars}, or None if no data."""
    ser = load_hourly_series(store, symbol, days=15)
    if not ser or not ser.get("ts") or len(ser["ts"]) < 32:
        return None
    hi, lo, cl, op = ser["high"], ser["low"], ser["close"], ser["open"]
    obs = ict.active_obs(hi, lo, cl, op)
    last_hour = _dt.datetime.fromisoformat(ser["ts"][-1]).strftime("%H:%M")
    setup = dict(_htf.htf_setup(hi, lo, cl, op, last_hour, active_obs=obs))
    # FRESHNESS gate: only surface a setup that TRIGGERED recently — a scanner wants
    # current signals, not the most-recent-near one from days ago in the series.
    if setup.get("present") and setup.get("bars_ago", 0) > _FRESH_BARS:
        setup = {"present": False, "stale_bars_ago": setup.get("bars_ago")}
    setup.update({"symbol": symbol, "as_of": ser["ts"][-1], "bars": len(ser["ts"])})
    return setup


#: scanner registry — id → per-symbol detector. Add a scanner = add an entry.
SCANNERS = {"ict_htf": _scan_ict_htf}

#: tier sort weight (A+ first, then B, then present-no-tier).
_TIER_RANK = {"A+": 0, "B": 1}


def run_scan(store, scanner: str = "ict_htf", refresh_bars: bool = False,
             refresh_universe: bool = False, lookback_days: int = 10) -> dict:
    """Run ``scanner`` across the universe. When ``refresh_bars``, first seed fresh
    60m bars for the universe. Returns a ranked result and persists it as the latest
    scan for this scanner type. Deterministic — no LLM, no orders."""
    detector = SCANNERS.get(scanner)
    if detector is None:
        return {"scanner": scanner, "available": False,
                "note": f"unknown scanner '{scanner}'"}
    uni = resolve_universe(store, refresh=refresh_universe)
    symbols = uni.get("symbols") or []
    seeded = None
    if refresh_bars:
        seeded = seed_hourly(store, symbols, lookback_days)

    hits, no_setup, no_data = [], [], []
    for sym in symbols:
        try:
            s = detector(store, sym)
        except Exception as e:  # noqa: BLE001 — one symbol must not break the scan
            log.warning("scan failed for %s: %s", sym, e)
            s = None
        if s is None:
            no_data.append(sym)
        elif s.get("present"):
            hits.append(s)
        else:
            no_setup.append(sym)

    hits.sort(key=lambda h: (_TIER_RANK.get(h.get("tier"), 9),
                             h.get("as_of") or ""), reverse=False)
    result = {
        "scanner": scanner,
        "ran_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
        "universe_source": uni.get("source"),
        "universe_n": len(symbols),
        "covered_n": len(symbols) - len(no_data),
        "hits": hits,
        "no_setup": sorted(no_setup),
        "no_data": sorted(no_data),
        "seeded": seeded,
    }
    if hasattr(store, "save_scanner_result"):
        store.save_scanner_result(scanner, result)
    return result


def scan_alerts(prev: dict | None, curr: dict) -> list[str]:
    """The FRESH-A+ diff for the hourly cron: symbols that are A+ now and were NOT
    A+ in the prior stored scan (dedup key = symbol+dir). Returns alert lines. Only
    A+ alerts — B/none are surfaced in the UI but never paged."""
    def _aplus(res):
        return {(h["symbol"], h.get("dir")): h
                for h in (res or {}).get("hits", []) if h.get("tier") == "A+"}
    before = _aplus(prev)
    now = _aplus(curr)
    fresh = [h for k, h in now.items() if k not in before]
    lines = []
    for h in sorted(fresh, key=lambda x: x["symbol"]):
        z = h.get("entry_zone") or []
        zone = f"{z[0]}–{z[1]}" if len(z) == 2 else "?"
        lines.append(
            f"⚡ A+ ICT setup · {h['symbol']} · {str(h.get('dir','')).upper()} · "
            f"zone {zone} · invalid {h.get('invalid')} · {h.get('reason','')}")
    return lines


def cron_run(store, scanner: str = "ict_htf") -> dict:
    """The hourly-cron entrypoint: read the prior scan, run a fresh one (seeding
    bars), and Telegram any FRESH A+. Reuses signal_bot.send_telegram. Returns a
    summary. Quiet by design — only fresh A+ pages."""
    prev = store.load_scanner_result(scanner)
    prev_result = (prev or {}).get("result")
    curr = run_scan(store, scanner, refresh_bars=True)
    alerts = scan_alerts(prev_result, curr)
    sent = 0
    if alerts:
        try:
            from . import signal_bot
            if signal_bot.telegram_configured(store):
                header = f"🔭 ICT Scanner — {len(alerts)} fresh A+ setup(s):"
                signal_bot.send_telegram(header + "\n" + "\n".join(alerts), store)
                sent = len(alerts)
        except Exception as e:  # noqa: BLE001 — alert failure must not fail the scan
            log.warning("scanner alert send failed: %s", e)
    return {"scanner": scanner, "hits": len(curr.get("hits", [])),
            "fresh_aplus": len(alerts), "alerts_sent": sent,
            "covered_n": curr.get("covered_n"), "universe_n": curr.get("universe_n")}


def main(argv=None) -> int:
    """CLI: `python -m vantage_server.scanner [--scanner ict_htf]` — one cron pass."""
    import argparse
    from .store import Store, resolve_data_dir
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(prog="vantage_server.scanner")
    ap.add_argument("--scanner", default="ict_htf")
    ap.add_argument("--data-dir", default=None)
    args = ap.parse_args(argv)
    store = Store(resolve_data_dir(args.data_dir))
    summary = cron_run(store, args.scanner)
    log.info("scanner %s", summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
