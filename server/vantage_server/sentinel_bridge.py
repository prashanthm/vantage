"""Read-only bridge to the Sentinel project's computed SPX intel artifacts.

Sentinel (~/personal/sentinel) is the SPX data engine: nightly it writes dealer
gamma (GEX), fractal support/resistance zones, market breadth + VIX regime, a
dated Fed/macro calendar, and a zone hit-rate scorecard to plain JSON files.
The 0DTE playbook fuses those — this module is the ONLY seam that touches
Sentinel, and it only ever READS. Every source degrades independently: a missing
or malformed file yields ``{"available": False, ...}`` rather than raising, so a
night when Sentinel hasn't run still produces a (thinner) playbook instead of a
crash.

Location is env-driven (``SENTINEL_LOGS_DIR`` / ``SENTINEL_DATA_DIR``) so the
containerized stack can mount Sentinel's ``logs/`` and ``data/`` read-only; the
defaults point at a local source checkout.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ENV_LOGS = "SENTINEL_LOGS_DIR"
ENV_DATA = "SENTINEL_DATA_DIR"
_DEFAULT_LOGS = "~/personal/sentinel/logs"
_DEFAULT_DATA = "~/personal/sentinel/data"


def _logs_dir() -> Path:
    return Path(os.path.expanduser(os.environ.get(ENV_LOGS, _DEFAULT_LOGS)))


def _data_dir() -> Path:
    return Path(os.path.expanduser(os.environ.get(ENV_DATA, _DEFAULT_DATA)))


def _read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _read_jsonl(path: Path) -> list[dict]:
    out: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return out


def _missing(name: str) -> dict:
    return {"available": False, "source": name}


# --------------------------------------------------------------- GEX snapshot

def gex_snapshot(store: Any = None, symbol: str = "^SPX") -> dict:
    """Latest dealer-gamma snapshot for ``symbol``: flip / walls / max_pain /
    regime / ladder.

    GEX is now computed NATIVELY in Vantage (``vantage_server.gex``). When a
    ``store`` is given, its own GEX snapshot is preferred; the Sentinel file is
    only a legacy fallback when Vantage hasn't computed one yet (SPX-only file).

    Shape: ``{spot, net_gex_bn, regime, regime_text, gamma_flip, call_wall,
    put_wall, max_pain, call_share_pct, put_share_pct, ladder[], curve[],
    narrative[], note, date, generated_at, n_contracts}``.
    """
    if store is not None and getattr(store, "uses_sqlite", False):
        try:
            d = store.load_gex_snapshot(symbol)
            if isinstance(d, dict) and d.get("spot") is not None:
                return {"available": True, **d}
        except Exception:  # noqa: BLE001 — fall back to the legacy file
            pass
    # legacy Sentinel file is SPX-only; non-SPX underlyings have no file fallback
    if symbol.upper() not in ("^SPX", "^GSPC", "SPX"):
        return _missing("gex")
    d = _read_json(_logs_dir() / "gex_snapshot.json")
    if not isinstance(d, dict) or d.get("spot") is None:
        return _missing("gex")
    return {"available": True, **d}


def gex_history(store: Any = None, symbol: str = "^SPX") -> list[dict]:
    """Nightly GEX rows for ``symbol`` (for the regime→next-day-vol edge). Prefers
    Vantage's own history; falls back to Sentinel's jsonl (SPX-only). May be empty."""
    if store is not None and getattr(store, "uses_sqlite", False):
        try:
            rows = store.load_gex_history(symbol)
            if rows:
                return rows
        except Exception:  # noqa: BLE001
            pass
    if symbol.upper() not in ("^SPX", "^GSPC", "SPX"):
        return []
    return _read_jsonl(_logs_dir() / "gex_history.jsonl")


# --------------------------------------------------------------- zones

def zones(source: str = "sentinel") -> dict:
    """The latest recorded S/R zones for ``source`` (sentinel|external|gex).

    Reads zone_intel_history.jsonl, keeps the newest record per source, returns
    ``{available, date, spot, zones:[{type,lo,hi,origin,flipped_from}]}``.
    """
    rows = _read_jsonl(_logs_dir() / "zone_intel_history.jsonl")
    latest = None
    for rec in rows:
        if rec.get("source") != source:
            continue
        if latest is None or (rec.get("date") or "") >= (latest.get("date") or ""):
            latest = rec
    if latest is None:
        return _missing("zones")
    return {"available": True, "date": latest.get("date"),
            "spot": latest.get("spot"), "zones": latest.get("zones", [])}


# --------------------------------------------------------------- market context

def market_context() -> dict:
    """Breadth + sector rotation + VIX term structure + intermarket macro.

    Now computed natively by Vantage (``market_context.py``) — no longer reads the
    retired Sentinel artifact. Shape: ``{breadth:{pct_above_50ma, ad_ratio,
    new_highs_20d, new_lows_20d}, sectors:[{etf,name,ret_20d_pct,...}], vol:{vix,
    vix3m, band, contango, stance}, intermarket:{dxy,tnx,oil,gold}, bullets:[...]}``.
    """
    from . import market_context as _mc  # noqa: PLC0415 — avoid import cycle at module load
    try:
        return _mc.market_context()
    except Exception:  # noqa: BLE001 — context is additive; never break the bundle
        return _missing("market_context")


# --------------------------------------------------------------- macro events

def macro_events() -> dict:
    """Dated Fed/macro calendar ``{ "YYYY-MM-DD": "FOMC"|"CPI"|"NFP"|"PCE"|... }``.

    Lives under Sentinel's data/ (not logs/). Returns ``{available, events:{...}}``.
    """
    d = _read_json(_data_dir() / "macro_events.json")
    if not isinstance(d, dict) or not d:
        return _missing("macro_events")
    return {"available": True, "events": d}


def catalysts_for(day: str, next_day: str | None = None) -> dict:
    """The macro catalyst (if any) landing on ``day`` and optionally ``next_day``."""
    ev = macro_events()
    events = ev.get("events", {}) if ev.get("available") else {}
    return {
        "available": ev.get("available", False),
        "today": events.get(day),
        "next_session": events.get(next_day) if next_day else None,
    }


# --------------------------------------------------------------- zone scorecard

def zone_scorecard() -> dict:
    """Zone hit-rate by source (the lookback edge), with a coverage honesty meter.

    Shape: ``{sources:{sentinel:{hit_rate, avg_coverage_pct, tested, bounces,
    breaks, days, n_zones}, ...}}``.
    """
    d = _read_json(_logs_dir() / "zone_scorecard.json")
    if not isinstance(d, dict) or not d.get("sources"):
        return _missing("zone_scorecard")
    return {"available": True, **d}


# --------------------------------------------------------------- bundle

def pull_all(day: str, next_day: str | None = None, store: Any = None,
             gex_symbol: str = "^SPX") -> dict:
    """Everything the playbook needs, each independently graceful. GEX comes from
    Vantage's own store (native, for ``gex_symbol``) when ``store`` is given;
    zones/breadth/macro still come from Sentinel's read-only artifacts (SPX-only).

    ``missing`` lists the sources that were unavailable so the playbook can note
    a thinner read rather than silently dropping a dimension."""
    parts = {
        "gex": gex_snapshot(store, gex_symbol),
        "gex_history": gex_history(store, gex_symbol),
        "zones": zones("sentinel"),
        "market_context": market_context(),
        "catalysts": catalysts_for(day, next_day),
        "zone_scorecard": zone_scorecard(),
    }
    missing = [k for k, v in parts.items()
               if isinstance(v, dict) and v.get("available") is False]
    return {**parts, "missing": missing}
