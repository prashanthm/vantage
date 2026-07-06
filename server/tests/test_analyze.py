"""The analyze I/O layer: journal write is append-only (prior-day files
untouched; same-day rerun backs up + overwrites; latest.json tracks the newest
day), the bars/universe orchestration over a stubbed data dir, and the
read-only API contract. Deterministic and offline — a temp data dir with
hand-written bars, no broker."""
from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

import pytest

from vantage_server import analyze, income
from vantage_server.technicals import Conviction, MultiTimeframeRead, TimeframeRead, Trend, Momentum


TODAY = _dt.date(2026, 7, 5)


def _decision(symbol, rec=income.MONITOR):
    return income.PositionDecision(
        symbol=symbol, as_of="2026-07-05", current_price=100.0,
        conviction=income.ConvictionView(label="neutral", score=0.0),
        recommendation=rec, rule="rule3_monitor", rationale="x",
        evidence={"per_tf": {}}, action_detail=None,
    )


# ---------------------------------------------------------- journal write

def test_write_journal_creates_day_and_latest(tmp_path):
    day_path, backup, latest_path = analyze.write_journal(
        tmp_path, "2026-07-05", [_decision("PLTR"), _decision("SOXS")],
        now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    assert day_path == tmp_path / "analysis" / "2026-07-05.json"
    assert backup is None
    data = json.loads(day_path.read_text())
    assert data["as_of"] == "2026-07-05"
    assert [d["symbol"] for d in data["decisions"]] == ["PLTR", "SOXS"]
    # latest.json mirrors the day
    latest = json.loads(latest_path.read_text())
    assert latest["as_of"] == "2026-07-05"


def test_same_day_rerun_backs_up_and_overwrites(tmp_path):
    analyze.write_journal(tmp_path, "2026-07-05", [_decision("PLTR")],
                          now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    # rerun same day with different content
    day_path, backup, _ = analyze.write_journal(
        tmp_path, "2026-07-05", [_decision("SOXS"), _decision("SNK")],
        now=_dt.datetime(2026, 7, 5, 22, 30, 0))
    assert backup is not None and backup.is_file()
    # backup holds the OLD content
    assert [d["symbol"] for d in json.loads(backup.read_text())["decisions"]] == ["PLTR"]
    # day file holds the NEW content
    new = json.loads(day_path.read_text())
    assert {d["symbol"] for d in new["decisions"]} == {"SOXS", "SNK"}


def test_prior_day_files_are_never_touched(tmp_path):
    d1, _, _ = analyze.write_journal(tmp_path, "2026-07-04", [_decision("PLTR")],
                                     now=_dt.datetime(2026, 7, 4, 21, 0, 0))
    day4_before = d1.read_text()
    # write a NEW day
    analyze.write_journal(tmp_path, "2026-07-05", [_decision("SOXS")],
                          now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    # prior day byte-identical
    assert (tmp_path / "analysis" / "2026-07-04.json").read_text() == day4_before
    # latest now points at the newer day
    latest = json.loads((tmp_path / "analysis" / "latest.json").read_text())
    assert latest["as_of"] == "2026-07-05"


def test_latest_tracks_newest_even_when_older_day_written_after(tmp_path):
    analyze.write_journal(tmp_path, "2026-07-05", [_decision("A")],
                          now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    # a backfill of an OLDER day must not make latest regress
    analyze.write_journal(tmp_path, "2026-07-01", [_decision("B")],
                          now=_dt.datetime(2026, 7, 5, 22, 0, 0))
    latest = json.loads((tmp_path / "analysis" / "latest.json").read_text())
    assert latest["as_of"] == "2026-07-05"


# ---------------------------------------------------------- journal reads

def test_load_day_and_symbol_history(tmp_path):
    analyze.write_journal(tmp_path, "2026-07-04",
                          [_decision("PLTR", income.MONITOR)],
                          now=_dt.datetime(2026, 7, 4, 21, 0, 0))
    analyze.write_journal(tmp_path, "2026-07-05",
                          [_decision("PLTR", income.CLOSE_AND_BOOK_LOSS),
                           _decision("SOXS")],
                          now=_dt.datetime(2026, 7, 5, 21, 0, 0))
    # latest
    latest = analyze.load_day(tmp_path, None)
    assert latest["as_of"] == "2026-07-05"
    # specific day
    day4 = analyze.load_day(tmp_path, "2026-07-04")
    assert day4["as_of"] == "2026-07-04"
    # missing day
    assert analyze.load_day(tmp_path, "2026-01-01") is None
    # symbol trail newest-first across all days
    trail = analyze.load_symbol_history(tmp_path, "pltr")
    assert [r["as_of"] for r in trail] == ["2026-07-05", "2026-07-04"]
    assert trail[0]["decision"]["recommendation"] == income.CLOSE_AND_BOOK_LOSS


def test_load_day_missing_dir_is_none(tmp_path):
    assert analyze.load_day(tmp_path, None) is None
    assert analyze.load_symbol_history(tmp_path, "PLTR") == []


# ---------------------------------------------------------- bars loading

def _make_bars(tmp_path, symbol, closes):
    daily = [{"date": f"2026-06-{i+1:02d}T00:00:00Z", "open": c, "high": c + 1,
              "low": c - 1, "close": c, "volume": 1000} for i, c in enumerate(closes)]
    (tmp_path / "bars").mkdir(exist_ok=True)
    (tmp_path / "bars" / f"{symbol}.json").write_text(json.dumps({
        "symbol": symbol, "as_of": "2026-07-05", "daily": daily,
        "weekly": daily, "monthly": daily,
    }))


def test_load_bars_missing_raises_with_hint(tmp_path):
    with pytest.raises(analyze.AnalyzeError) as e:
        analyze.load_bars(tmp_path, "NOPE")
    assert "snapshot_bars" in str(e.value)


def test_current_price_is_last_daily_close(tmp_path):
    _make_bars(tmp_path, "PLTR", [10, 11, 12, 13])
    bars = analyze.load_bars(tmp_path, "PLTR")
    assert analyze.current_price_from_bars(bars) == 13.0


# ---------------------------------------------------------- CLI dry-run

def test_cli_reports_missing_bars_clearly(tmp_path, monkeypatch, capsys):
    """analyze depends on snapshot bars; with none present it must fail with
    exit 2 and tell the operator to run snapshot_bars."""
    # minimal data dir: lots + accounts etc. via a stubbed Store universe
    monkeypatch.setattr(analyze, "build_positions_ctx",
                        lambda *a, **k: (_ for _ in ()).throw(
                            analyze.AnalyzeError(
                                "missing bars for: PLTR — run 'python -m "
                                "vantage_server.snapshot_bars --from-lots' first")))
    rc = analyze.main(["--data-dir", str(tmp_path), "--as-of", "2026-07-05"])
    assert rc == analyze.EXIT_USER_ERROR
    assert "snapshot_bars" in capsys.readouterr().err
