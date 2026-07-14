"""Chart-snapshot journal — forecast vs. what actually happened.

Save a chart image alongside the playbook forecast that was live when you
captured it, then later SCORE it against real price action: did the levels the
playbook called hold or break? Was the regime call (range vs momentum) right?
Over many snapshots this builds an evidence-based track record of whether the
projections are worth trusting — the whole point.

Image bytes live on disk under the journal dir (``<data_dir>/journal/``); the DB
row holds the metadata, a FROZEN copy of the forecast, and a later-computed
scorecard. Journal/analysis only — places no orders (ADR-010). Not advice.
"""
from __future__ import annotations

import datetime as _dt
import os
from pathlib import Path
from zoneinfo import ZoneInfo

from .store import Store, resolve_data_dir

ET = ZoneInfo("America/New_York")

#: how close price must come to "test" a level (fraction of price).
_TOUCH_PCT = 0.0007   # ~0.07% ≈ 5pt at SPX 7500
#: a level is "broken" if price closes beyond it by more than this.
_BREAK_PCT = 0.0015   # ~0.15%


def journal_dir(data_dir: str | os.PathLike[str]) -> Path:
    """The directory where snapshot images are stored (created on demand)."""
    d = Path(data_dir) / "journal"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── freeze the live forecast at capture time ─────────────────────────────────

def forecast_from_scaffold(scaffold: dict) -> dict:
    """Extract the parts of the playbook we want to SCORE later: the regime call,
    spot, the plan line, and the key levels with their role + expected reaction.
    Frozen into the snapshot so the score compares against what was actually
    showing, not a later-recomputed playbook."""
    reg = scaffold.get("regime") or {}
    table = scaffold.get("table") or {}
    levels = []
    for r in table.get("rows") or []:
        levels.append({
            "key": r.get("key"), "price": r.get("price"),
            "label": r.get("label"), "role": r.get("role"),
            "expect": r.get("expect"), "confluence": bool(r.get("confluence")),
            "durable": bool(r.get("durable")),
        })
    return {
        "session": scaffold.get("session"),
        "generated_for": scaffold.get("generated_for"),
        "spot": reg.get("spot"),
        "gamma": reg.get("gamma"),
        "vix": reg.get("vix"),
        "gamma_flip": next((r["price"] for r in (scaffold.get("level_ladder") or [])
                            if "flip" in (r.get("kind") or "").lower()), None),
        "plan": table.get("read"),
        "structure_note": table.get("structure_note"),
        "levels": levels,
    }


def pick_forecast(store: Store, day: str, kind: str = "prior",
                  symbol: str = "SPX") -> tuple[dict, dict, str]:
    """Choose which playbook forecast to freeze into a new journal entry, for the
    given ``symbol`` (SPX | QQQ | IWM).

    ``kind="prior"`` (default) freezes LAST NIGHT'S / the prior session's playbook
    — so the entry compares "yesterday's levels vs today's action". Falls back to
    the current playbook if no prior one exists (e.g. very first day).
    ``kind="live"`` freezes whatever playbook is current.

    Returns ``(scaffold, forecast, resolved_kind)`` where forecast is the frozen,
    scoreable slice. All reads are store-only (ADR-010)."""
    row = None
    resolved = kind
    if kind == "prior":
        row = store.load_spx_playbook_before(day, symbol)
        if row is None:  # no earlier session — fall back to whatever's live
            row = store.load_spx_playbook(symbol=symbol)
            resolved = "live"
    else:
        row = store.load_spx_playbook(symbol=symbol)
        resolved = "live"
    scaffold = (row or {}).get("scaffold") or {}
    forecast = forecast_from_scaffold(scaffold) if scaffold else {}
    return scaffold, forecast, resolved


#: the light-structured trade-action log ("what I did"). Free-text fields; empty
#: strings are fine. Stored as JSON so the shape can grow without a migration.
#: `trades` is a JSON map {trade_key: why} — the thinking behind each
#: individual decision (the broker says WHAT; only the operator says WHY).
ENTRY_FIELDS = ("action", "entry", "exit", "result", "lesson", "notes", "trades")


def normalize_entry(raw: dict | None) -> dict | None:
    """Coerce a posted entry to the known fields (extra keys dropped, values
    stringified). Returns None when every field is blank so we don't store an
    empty shell."""
    if not raw:
        return None
    out = {}
    for k in ENTRY_FIELDS:
        v = raw.get(k)
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out[k] = s
    return out or None


# ── score the forecast against later price action ────────────────────────────

def _price_range_since(symbol: str, since_iso: str):
    """(low, high, last, n_bars) of ``symbol`` 15m bars strictly AFTER ``since``.
    Returns None if bars unavailable or none after the snapshot."""
    from . import spx_playbook as sp
    df = sp._fetch_15m(symbol)
    if df is None or getattr(df, "empty", True):
        return None
    lows, highs, closes = [], [], []
    for ts, row in df.iterrows():
        if ts.to_pydatetime().isoformat() <= since_iso:
            continue
        lows.append(float(row["Low"])); highs.append(float(row["High"]))
        closes.append(float(row["Close"]))
    if not closes:
        return None
    return min(lows), max(highs), closes[-1], len(closes)


def _price_range_for_day(symbol: str, day: str):
    """(low, high, last, n_bars) over the WHOLE RTH session of ``day``
    (YYYY-MM-DD), regardless of what time the snapshot was created. This is what
    the daily entry scores against, so opening the page midday or after the close
    still reads the full session — not just bars printed after you looked. Returns
    None if no bars fall on that day."""
    from . import spx_playbook as sp
    df = sp._fetch_15m(symbol)
    if df is None or getattr(df, "empty", True):
        return None
    lows, highs, closes = [], [], []
    for ts, row in df.iterrows():
        if ts.to_pydatetime().date().isoformat() != day:
            continue
        lows.append(float(row["Low"])); highs.append(float(row["High"]))
        closes.append(float(row["Close"]))
    if not closes:
        return None
    return min(lows), max(highs), closes[-1], len(closes)


def score_forecast(forecast: dict, price_low: float, price_high: float,
                   price_last: float, spot_at_snap: float | None) -> dict:
    """Given the price range since the snapshot, judge each forecast level and the
    regime call. A level is TESTED if price came within _TOUCH_PCT; HELD if tested
    but not broken through; BROKEN if price closed beyond it by _BREAK_PCT (for a
    resistance = above, support = below). Returns a scorecard with per-level
    verdicts + a regime verdict + a simple accuracy score."""
    results = []
    for lv in forecast.get("levels", []):
        p = lv.get("price"); role = lv.get("role")
        if p is None:
            continue
        touch = p * _TOUCH_PCT
        brk = p * _BREAK_PCT
        tested = (price_low <= p + touch) and (price_high >= p - touch)
        if role == "resistance":
            broken = price_high > p + brk and price_last > p
            held = tested and not broken
        elif role == "support":
            broken = price_low < p - brk and price_last < p
            held = tested and not broken
        else:  # pivot / flip
            broken = False
            held = tested
        verdict = ("held" if held else "broken" if broken else
                   "tested" if tested else "untested")
        results.append({"key": lv.get("key"), "price": p, "role": role,
                        "label": lv.get("label"), "verdict": verdict})

    # regime call: positive gamma predicted a RANGE (mean-reversion). Score it by
    # whether price stayed rangey vs trended hard from the snapshot spot.
    regime_verdict = None
    if spot_at_snap:
        moved_pct = max(abs(price_high - spot_at_snap),
                        abs(price_low - spot_at_snap)) / spot_at_snap * 100
        ranged = moved_pct < 1.0    # <1% swing from snap = a range held
        if forecast.get("gamma") == "positive":
            regime_verdict = {"call": "range (positive gamma)",
                              "outcome": "held" if ranged else "broke to a trend",
                              "moved_pct": round(moved_pct, 2), "correct": ranged}
        elif forecast.get("gamma") == "negative":
            regime_verdict = {"call": "momentum (negative gamma)",
                              "outcome": "trended" if not ranged else "stayed rangey",
                              "moved_pct": round(moved_pct, 2), "correct": not ranged}

    # accuracy: of the levels price actually TESTED, how many HELD/reacted as the
    # role implied? (untested levels don't count for or against.)
    tested_levels = [r for r in results if r["verdict"] in ("held", "broken", "tested")]
    reacted = [r for r in tested_levels if r["verdict"] in ("held", "tested")]
    level_accuracy = round(len(reacted) / len(tested_levels), 3) if tested_levels else None

    return {
        "price_low": round(price_low, 1), "price_high": round(price_high, 1),
        "price_last": round(price_last, 1),
        "levels": results,
        "regime": regime_verdict,
        "level_accuracy": level_accuracy,
        "n_tested": len(tested_levels),
    }


def _bar_symbol_for(underlying: str | None) -> str:
    """Map a journal snapshot's stored underlying (SPX | QQQ | IWM) to the
    yfinance bar symbol its price action is scored against."""
    from . import underlyings as _u
    return _u.get(underlying)["bar_symbol"]


def score_snapshot(snap: dict, symbol: str | None = None) -> dict | None:
    """Compute the scorecard for one snapshot against price action.

    Scores against the FULL RTH session of the snapshot's day (open→close), so
    opening the page midday or after the close still reads the whole session, not
    just bars printed after you looked. The bar symbol is derived from the
    snapshot's own underlying (SPX→^GSPC, QQQ→QQQ, IWM→IWM) unless ``symbol`` is
    given explicitly. Returns the scorecard, or None if no bars that day yet."""
    bar_sym = symbol or _bar_symbol_for(snap.get("symbol"))
    day = (snap.get("created_at") or "")[:10]
    rng = _price_range_for_day(bar_sym, day) if day else None
    if rng is None:
        return None
    low, high, last, n = rng
    sc = score_forecast(snap.get("forecast") or {}, low, high, last,
                        snap.get("spot_at_snap"))
    sc["bars_since"] = n
    return sc


def score_all_open(store: Store, symbol: str | None = None) -> dict:
    """(Re)score every snapshot that has bars since capture, each against its own
    underlying's bars. Returns counts."""
    snaps = store.load_journal_snapshots()
    now = _dt.datetime.now(ET).isoformat()
    scored = 0
    for s in snaps:
        sc = score_snapshot(s, symbol)   # symbol=None → per-snapshot underlying
        if sc and store.update_journal_scorecard(s["id"], sc, now):
            scored += 1
    return {"snapshots": len(snaps), "scored": scored}


# ── overall accuracy across the journal (the confidence read) ────────────────

def journal_accuracy(snaps: list[dict]) -> dict:
    """Aggregate the scorecards into a running confidence read: overall level
    accuracy and regime-call hit rate across all scored snapshots."""
    scored = [s for s in snaps if s.get("scorecard")]
    if not scored:
        return {"n_scored": 0}
    lvl_acc = [s["scorecard"]["level_accuracy"] for s in scored
               if s["scorecard"].get("level_accuracy") is not None]
    regimes = [s["scorecard"].get("regime") for s in scored if s["scorecard"].get("regime")]
    regime_correct = [r for r in regimes if r.get("correct")]
    return {
        "n_scored": len(scored),
        "avg_level_accuracy": round(sum(lvl_acc) / len(lvl_acc), 3) if lvl_acc else None,
        "regime_calls": len(regimes),
        "regime_hit_rate": round(len(regime_correct) / len(regimes), 3) if regimes else None,
    }


def ensure_today_entry(store: Store, underlying: str = "SPX") -> dict:
    """Make sure a journal entry exists for TODAY for ``underlying``, then keep it
    current.

    On the first open of a trading day this auto-creates one entry (idempotent —
    one per underlying per day) freezing LAST NIGHT'S forecast, so you arrive to a
    ready row and just drop your chart + log what you did. On every open it
    re-scores today's entry against live price (until the day's bars stop
    printing). Store/disk-only writes (ADR-010).

    Returns ``{created: bool, id, rescored: bool}``."""
    if not getattr(store, "uses_sqlite", False):
        return {"created": False, "id": None, "rescored": False}
    key = (underlying or "SPX").upper()
    now = _dt.datetime.now(ET)
    today = now.date().isoformat()
    existing = store.load_journal_snapshot_for_day(today, key)
    created = False
    if existing is None:
        scaffold, forecast, resolved = pick_forecast(store, today, "prior", key)
        sid = store.record_journal_snapshot({
            "created_at": now.isoformat(),
            "session": forecast.get("session") or scaffold.get("session"),
            "symbol": key, "image_path": None, "image_mime": None, "note": None,
            "spot_at_snap": (scaffold.get("regime") or {}).get("spot"),
            "forecast": forecast, "forecast_kind": resolved,
        })
        created = True
        existing = store.load_journal_snapshot(sid)
    # re-score today's entry against its own underlying's live price
    rescored = False
    if existing:
        sc = score_snapshot(existing)   # bar symbol derived from the snapshot
        if sc and store.update_journal_scorecard(existing["id"], sc, now.isoformat()):
            rescored = True
    return {"created": created, "id": existing["id"] if existing else None,
            "rescored": rescored}


def ensure_all_underlyings(store: Store) -> list[dict]:
    """Ensure today's entry for every tracked underlying (SPX/QQQ/IWM). Best-
    effort per underlying so one bad symbol can't block the others."""
    from . import underlyings as _u
    out = []
    for key in _u.UNDERLYING_KEYS:
        try:
            out.append({"symbol": key, **ensure_today_entry(store, key)})
        except Exception:  # noqa: BLE001 — additive, never block the journal
            out.append({"symbol": key, "created": False, "id": None, "rescored": False})
    return out


def build_journal(store: Store, symbol: str | None = None) -> dict:
    """The journal view for ``symbol`` (all underlyings when None): every snapshot
    (metadata + forecast + scorecard) and the running accuracy. Image bytes are
    served separately via the image route."""
    snaps = store.load_journal_snapshots(symbol)
    return {
        "snapshots": snaps,
        "accuracy": journal_accuracy(snaps),
        "symbol": symbol,
        "note": ("Each entry pairs a playbook forecast (last night's by default) "
                 "with what price actually did; today's entry is created for you "
                 "and re-scored on open. Journal/analysis only — no orders (ADR-010)."),
    }
