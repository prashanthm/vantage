"""SPX 0DTE playbook: sentinel_bridge degrade, scaffold assembly, OpEx/edges, store.

Bar fetches are monkeypatched to a deterministic fixture frame so no test touches
Yahoo; Sentinel artifacts are written to a temp dir the bridge reads via env.
"""
from __future__ import annotations

import datetime as _dt
import json

import pandas as pd
import pytest

from vantage_server import sentinel_bridge as sb
from vantage_server import spx_playbook as pb


# ------------------------------------------------------------ sentinel_bridge

@pytest.fixture
def sentinel_dir(tmp_path, monkeypatch):
    logs = tmp_path / "logs"; data = tmp_path / "data"
    logs.mkdir(); data.mkdir()
    (logs / "gex_snapshot.json").write_text(json.dumps({
        "spot": 7503.85, "net_gex_bn": 32.5, "regime": "positive",
        "regime_text": "positive gamma", "gamma_flip": 7481.0, "call_wall": 7550.0,
        "put_wall": 7450.0, "max_pain": 7500.0, "ladder": [], "curve": [],
        "narrative": [], "date": "2026-07-07", "generated_at": "2026-07-07",
    }))
    (logs / "gex_history.jsonl").write_text(
        "\n".join(json.dumps({"date": d, "regime": r}) for d, r in [
            ("2026-06-30", "negative"), ("2026-07-01", "negative"),
            ("2026-07-06", "positive"), ("2026-07-07", "positive")]))
    (logs / "zone_intel_history.jsonl").write_text(json.dumps({
        "date": "2026-07-08", "source": "sentinel", "spot": 7503.85,
        "zones": [{"type": "supply", "lo": 7550, "hi": 7555, "origin": "prior_high"}]}))
    (logs / "market_context.json").write_text(json.dumps({
        "breadth": {"pct_above_50ma": 58.4, "ad_ratio": 1.56},
        "vol": {"vix": 16.13, "vix3m": 19.0, "band": "normal", "contango": True},
        "sectors": [], "bullets": []}))
    (logs / "zone_scorecard.json").write_text(json.dumps({
        "sources": {"sentinel": {"hit_rate": 0.444, "avg_coverage_pct": 17.5,
                                 "tested": 18, "bounces": 8, "breaks": 10}}}))
    (data / "macro_events.json").write_text(json.dumps({
        "2026-07-07": "CPI", "2026-07-29": "FOMC"}))
    monkeypatch.setenv(sb.ENV_LOGS, str(logs))
    monkeypatch.setenv(sb.ENV_DATA, str(data))
    return tmp_path


def test_bridge_reads_all_sources(sentinel_dir):
    b = sb.pull_all("2026-07-07", "2026-07-08")
    assert b["missing"] == []
    assert b["gex"]["gamma_flip"] == 7481.0
    assert b["zones"]["date"] == "2026-07-08"
    assert b["market_context"]["vol"]["vix"] == 16.13
    assert b["catalysts"]["today"] == "CPI"
    assert b["zone_scorecard"]["sources"]["sentinel"]["hit_rate"] == 0.444


def test_bridge_degrades_on_missing(tmp_path, monkeypatch):
    monkeypatch.setenv(sb.ENV_LOGS, str(tmp_path / "nope"))
    monkeypatch.setenv(sb.ENV_DATA, str(tmp_path / "nope"))
    b = sb.pull_all("2026-07-07")
    assert set(b["missing"]) >= {"gex", "zones", "market_context", "zone_scorecard"}
    assert b["gex"]["available"] is False  # never raises


# ------------------------------------------------------------ OpEx / DTE

def test_opex_monthly_third_friday():
    o = pb.opex_layer(_dt.date(2026, 7, 7))
    assert o["next_opex"] == "2026-07-17"  # 3rd Friday of July 2026
    assert o["next_opex_dte"] == 10
    assert o["next_opex_quarterly"] is False


def test_opex_quarterly_triple_witching():
    o = pb.opex_layer(_dt.date(2026, 6, 1))
    assert o["next_opex"] == "2026-06-19"  # 3rd Friday June = quarterly
    assert o["next_opex_quarterly"] is True


def test_opex_today_is_opex():
    o = pb.opex_layer(_dt.date(2026, 6, 19))
    assert o["today_is_opex"] is True
    assert o["today_is_triple_witching"] is True


# ------------------------------------------------------------ bar-based dims

def _fake_15m(days=12, base=7500.0):
    """Deterministic 15m RTH frame: `days` sessions, 26 bars each."""
    rows = []
    ts = []
    start = _dt.date(2026, 6, 22)
    d = start
    made = 0
    while made < days:
        if d.weekday() < 5:
            for slot in range(26):
                t = _dt.datetime(d.year, d.month, d.day, 9, 30) + _dt.timedelta(minutes=15 * slot)
                px = base + (made * 5) + (slot - 13) * 1.5  # gentle drift + intrabar
                rows.append({"Open": px, "High": px + 3, "Low": px - 3,
                             "Close": px + 1, "Volume": 1_000_000 + slot * 10_000})
                ts.append(pd.Timestamp(t, tz="America/New_York"))
            made += 1
        d += _dt.timedelta(1)
    return pd.DataFrame(rows, index=pd.DatetimeIndex(ts))


def test_chart_dimensions_recent_window():
    spx = _fake_15m(days=12)
    spyvol = {t: float(v) for t, v in zip(spx.index, spx["Volume"])}
    dims = pb._chart_dimensions(spx, spyvol)
    assert dims["available"]
    assert "38.2%" in dims["fib"] and "78.6%" in dims["fib"]
    assert dims["vwap"] is not None
    assert dims["poc"] is not None
    # recent window only keeps the last N sessions
    assert dims["swing_high"] >= dims["swing_low"]


def test_gex_regime_vol_edge():
    spx = _fake_15m(days=12)
    hist = [{"date": "2026-06-23", "regime": "negative"},
            {"date": "2026-06-24", "regime": "positive"}]
    edge = pb.gex_regime_vol_edge(hist, spx)
    assert edge["available"]
    assert "positive_gamma" in edge and "negative_gamma" in edge


def test_day_time_edges():
    spx = _fake_15m(days=12)
    e = pb.day_time_edges(spx)
    assert e["available"]
    assert "open (9:30-10:15)" in e["by_slot"]
    assert set(e["by_weekday"]) <= {"Mon", "Tue", "Wed", "Thu", "Fri"}


# ------------------------------------------------------------ confluence / volume / table

def test_confluence_merges_two_dimensions():
    # today's real case: fib-50 (7423) + a support shelf (7430) stack into one
    # support-confluence zone; an isolated level (7550, one dim) does NOT.
    ladder = [
        {"price": 7550.0, "kind": "GEX call wall (resistance)", "source": "GEX"},
        {"price": 7430.0, "kind": "support (3x tested)", "source": "chart"},
        {"price": 7423.0, "kind": "fib 50.0%", "source": "chart"},
        {"price": 7300.0, "kind": "round number", "source": "psych"},
    ]
    zones = pb.build_confluence(ladder, spot=7480.0)
    # the 7423/7430 pair merges (fib + sr = 2 dims); 7550 and 7300 are isolated
    conf = [z for z in zones if z["strength"] >= 2]
    assert len(conf) == 1
    z = conf[0]
    assert 7423.0 <= z["price"] <= 7430.0
    assert z["role"] == "support"           # below spot
    assert set(z["dims"]) == {"fib", "sr"}


def test_level_ladder_round_step_is_per_underlying():
    # SPX uses 50pt round numbers; QQQ uses 5 — the ladder must honor the scale.
    chart = {"available": True, "last": 725.0, "fib": {}, "poc": None,
             "resistance": [], "support": []}
    gex = {"available": False}
    spx_ladder = pb.build_level_ladder(gex, {"available": True, "last": 7250.0,
                                             "fib": {}, "poc": None,
                                             "resistance": [], "support": []})
    qqq_ladder = pb.build_level_ladder(gex, chart, scale={"round_step": 5, "cluster_tol": 0.6})
    spx_rounds = sorted(r["price"] for r in spx_ladder if r["kind"] == "round number")
    qqq_rounds = sorted(r["price"] for r in qqq_ladder if r["kind"] == "round number")
    assert spx_rounds == [7200.0, 7250.0, 7300.0]      # 50-wide
    assert qqq_rounds == [720.0, 725.0, 730.0]         # 5-wide


def test_underlyings_registry():
    from vantage_server import underlyings as u
    assert u.get("QQQ")["bar_symbol"] == "QQQ" and u.get("QQQ")["self_proxy"] is True
    assert u.get("SPX")["proxy_symbol"] == "SPY" and u.get("SPX")["self_proxy"] is False
    assert u.get("iwm")["gex_symbol"] == "IWM"          # case-insensitive
    assert u.get("bogus")["label"] == "SPX"             # unknown → SPX default


def test_confluence_stays_tight_not_a_megazone():
    # a run of evenly-spaced (>tol apart) levels must NOT chain into one wide zone
    ladder = [{"price": 7500.0 - i * 12, "kind": f"fib {i}", "source": "chart"}
              for i in range(6)]  # 12pt apart, tol at 7480 ~11pt
    zones = pb.build_confluence(ladder, spot=7460.0)
    for z in zones:
        assert z["hi"] - z["lo"] <= 12.0    # no mega-zone


def test_volume_read_fading_into_low():
    closes = [7500 - i for i in range(10)]           # declining
    opens = [c + 1 for c in closes]
    vols = [200, 190, 180, 100, 90, 80, 70, 60, 55, 50]  # fading
    r = pb._volume_read(closes, opens, vols)
    assert r["trend"] == "fading"
    assert "exhaustion" in r["note"] or "weak" in r["note"]


def test_volume_read_expanding_on_push():
    closes = [7400 + i * 3 for i in range(10)]       # rising
    opens = [c - 2 for c in closes]
    vols = [60, 60, 60, 60, 70, 90, 120, 160, 200, 260]  # expanding
    r = pb._volume_read(closes, opens, vols)
    assert r["trend"] == "expanding"


# ------------------------------------------------------------ structure read

def test_structure_read_uptrend_and_bos():
    # rising swings (HH + HL) then a fresh push above the last swing high = BOS.
    # zig-zag so pivots form on BOTH highs and lows (n=1 needs a strict peak/trough).
    highs = [20, 12, 30, 18, 45, 25, 60, 40]
    lows =  [8,  5,  15, 9,  25, 18, 40, 30]
    closes = [15, 8, 22, 12, 35, 20, 50, 70]  # last close pops above swing high 60
    r = pb._structure_read(highs, lows, closes, n=1)
    assert r["state"] == "uptrend"
    # plain-language note: "trending up …; just pushed above <N> (turning up)"
    assert "turning up" in r["note"] and r["last_break"] is not None


def test_structure_read_unclear_when_too_few_swings():
    r = pb._structure_read([1, 2, 3], [1, 1, 1], [1, 2, 3], n=1)
    assert r["state"] == "unclear"


# ------------------------------------------------------------ durable levels

def test_durable_promotes_level_seen_across_sessions():
    # a 7423 support shelf recorded on 4 distinct sessions, price respected it
    # (touched the band, closed back above) → durable; a one-off level is dropped.
    hist = []
    for d in ("2026-06-24", "2026-06-25", "2026-06-26", "2026-06-29"):
        hist.append({"session": d, "price": 7423.0, "dim": "support",
                     "kind": "support (3x tested)", "day_low": 7420.0,
                     "day_high": 7470.0, "day_close": 7465.0})
    hist.append({"session": "2026-06-24", "price": 7101.0, "dim": "support",
                 "kind": "support (2x)", "day_low": 7100.0, "day_high": 7150.0,
                 "day_close": 7140.0})   # one-off — below min_sessions
    durable = pb.build_durable_levels(hist, spot=7480.0, min_sessions=3)
    assert len(durable) == 1
    z = durable[0]
    assert abs(z["price"] - 7423.0) < 1.0
    assert z["sessions"] == 4 and z["respected"] == 4
    assert z["role"] == "support" and z["durable"] is True


def test_durable_empty_without_enough_history():
    assert pb.build_durable_levels([], spot=7480.0) == []


def test_session_levels_for_history_flattens_chart_and_gex():
    chart = {"available": True, "support": [(7423.0, 3)], "resistance": [(7550.0, 2)],
             "poc": 7500.0, "swing_high": 7560.0, "swing_low": 7410.0}
    gex = {"available": True, "call_wall": 7600.0, "put_wall": 7400.0,
           "gamma_flip": 7480.0, "max_pain": 7500.0}
    lvls = pb.session_levels_for_history(chart, gex)
    dims = {l["dim"] for l in lvls}
    assert {"support", "resistance", "poc", "swing", "gex_wall", "gamma_flip",
            "max_pain"} <= dims
    # GEX levels carry source=GEX so a forward-accrued persistence read can find them
    assert any(l["source"] == "GEX" for l in lvls)


def test_build_table_dedups_and_reads():
    ladder = [
        {"price": 7550.0, "kind": "GEX call wall (resistance)", "source": "GEX"},
        {"price": 7481.0, "kind": "gamma flip (regime line)", "source": "GEX"},
        {"price": 7453.0, "kind": "fib 61.8%", "source": "chart"},
        {"price": 7450.0, "kind": "GEX put wall (support)", "source": "GEX"},
    ]
    conf = pb.build_confluence(ladder, spot=7480.0)   # 7450+7453 → one zone
    chart = {"last": 7480.0, "volume_read": {"trend": "expanding", "note": "expanding on the push"}}
    gex = {"available": True, "gamma_flip": 7481.0}
    regime = {"spot": 7480.0, "gamma": "positive", "vix": 16.0}
    t = pb.build_table(ladder, conf, gex, chart, regime)
    # the put wall (7450) folded into the 7450/7453 confluence → not a duplicate row
    prices = [r["price"] for r in t["rows"]]
    assert len([p for p in prices if abs(p - 7451) < 3]) == 1
    assert t["volume_note"] == "expanding on the push"
    # plain-language read references the flip level (the "7481 line") + dip/rally levels
    assert "7481 line" in t["read"]
    assert "buy dips" in t["read"] and "sell rallies" in t["read"]


def test_write_pine_file(tmp_path, monkeypatch):
    monkeypatch.setenv("VANTAGE_PINE_DIR", str(tmp_path))
    scaffold = {
        "symbol": "SPX",
        "session": "2026-07-09", "generated_for": "2026-07-08",
        "regime": {"gamma": "positive", "spot": 7480.0},
        "level_ladder": [{"price": 7481.0, "kind": "gamma flip (regime line)", "source": "GEX"}],
        "confluence": [], "table": {"read": "x", "rows": [], "volume_note": "", "regime_line": ""},
        "setups": [],
    }
    path = pb.write_pine_file(scaffold)
    assert path is not None
    written = (tmp_path / "spx_playbook.pine").read_text()
    assert written.startswith("//@version=5")
    assert "flipLevel = 7481.0" in written
    # the prefilled reclaim indicator is regenerated in lockstep, GEX baked in
    reclaim = (tmp_path / "reclaim_indicator_SPX.pine").read_text()
    assert 'indicator("Reclaim Strategy — SPX (GEX)"' in reclaim
    assert 'input.text_area("7481|gamma flip (regime line)"' in reclaim


def test_write_reclaim_pine_file_bakes_symbol_levels(tmp_path, monkeypatch):
    monkeypatch.setenv("VANTAGE_PINE_DIR", str(tmp_path))
    scaffold = {"symbol": "QQQ", "level_ladder": [
        {"price": 500.0, "kind": "call wall", "source": "GEX"},
        {"price": 480.0, "kind": "put wall", "source": "GEX"},
        {"price": 490.0, "kind": "fib 50%", "source": "chart"},  # transient -> excluded
    ]}
    path = pb.write_reclaim_pine_file(scaffold)
    assert path is not None and path.endswith("reclaim_indicator_QQQ.pine")
    s = (tmp_path / "reclaim_indicator_QQQ.pine").read_text()
    assert 'input.text_area("500|call wall, 480|put wall"' in s   # walls baked with labels, fib dropped
    assert 'indicator("Reclaim Strategy — QQQ (GEX)"' in s


def test_write_pine_file_none_when_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("VANTAGE_PINE_DIR", str(tmp_path))
    assert pb.write_pine_file({"level_ladder": [], "confluence": []}) is None


# ------------------------------------------------------------ full assembly

def test_build_playbook_full(sentinel_dir, monkeypatch):
    monkeypatch.setattr(pb, "_fetch_15m", lambda sym: _fake_15m(days=12))
    monkeypatch.setattr(pb, "_fetch_daily", lambda sym="^GSPC": _fake_15m(days=3))
    s = pb.build_playbook(_dt.date(2026, 7, 7))
    assert s["symbol"] == "SPX"
    assert s["session"] == "2026-07-08"
    assert s["regime"]["gamma"] == "positive"
    assert s["regime"]["vix"] == 16.13
    # level ladder fuses GEX + chart levels, sorted high->low
    prices = [r["price"] for r in s["level_ladder"]]
    assert prices == sorted(prices, reverse=True)
    assert any("gamma flip" in r["kind"] for r in s["level_ladder"])
    # conditional setups tied to real levels
    assert s["setups"] and all("trigger" in su and "structure" in su for su in s["setups"])
    assert any("7481" in su["trigger"] for su in s["setups"])  # the flip level
    # catalyst + caveats present
    assert s["catalysts"]["today"] == "CPI"
    assert any("0DTE" in c for c in s["caveats"])
    assert any("ADR-008" in c for c in s["caveats"])


def test_setups_are_conditional_not_bare(sentinel_dir, monkeypatch):
    monkeypatch.setattr(pb, "_fetch_15m", lambda sym: _fake_15m(days=12))
    s = pb.build_playbook(_dt.date(2026, 7, 7))
    # every setup names a trigger condition (IF ...), never a bare "buy calls"
    for su in s["setups"]:
        assert su["trigger"], "setup must have a trigger condition"
        assert "buy calls" not in su["structure"].lower() or "IF" in su["trigger"]


# ------------------------------------------------------------ store round-trip

def test_store_playbook_roundtrip(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    store = Store.__new__(Store)
    store.data_dir = tmp_path; store._db_path = tmp_path / "vantage.db"
    store._backend = _SqliteBackend(tmp_path, tmp_path / "vantage.db")
    scaffold = {"session": "2026-07-08", "level_ladder": [{"price": 7500}], "setups": []}
    store.upsert_spx_playbook("2026-07-07", scaffold)
    row = store.load_spx_playbook()
    assert row["date"] == "2026-07-07"
    assert row["scaffold"]["session"] == "2026-07-08"
    assert row["narrative"] is None
    assert store.save_spx_playbook_narrative("2026-07-07", {"text": "hi"}) is True
    assert store.load_spx_playbook()["narrative"] == {"text": "hi"}


# ------------------------------------------------------------ API route

@pytest.fixture(autouse=True)
def _fixture_quotes(monkeypatch):
    monkeypatch.setenv("VANTAGE_QUOTES", "fixture")


@pytest.fixture
def seeded_dir(tmp_path, data_dir):
    """A SQLite store seeded from the fixture dataset (mirrors test_notebook)."""
    from vantage_server.store import Store, _SqliteBackend
    store = Store.__new__(Store)
    store.data_dir = tmp_path; store._db_path = tmp_path / "vantage.db"
    store._backend = _SqliteBackend(tmp_path, tmp_path / "vantage.db")
    accounts = json.loads((data_dir / "accounts.json").read_text())
    lots = json.loads((data_dir / "lots.json").read_text())
    quotes = json.loads((data_dir / "quotes.json").read_text())
    store.upsert_accounts(accounts)
    store.upsert_lots([a["id"] for a in accounts], lots, mode="replace",
                      now="2026-07-05T00:00:00+00:00")
    store.set_quotes(quotes["quotes"], as_of=quotes["as_of"])
    for name in ("quotes.json", "accounts.json", "lots.json"):
        (tmp_path / name).write_text((data_dir / name).read_text(), encoding="utf-8")
    return tmp_path, store


def test_playbook_route_empty_state(seeded_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, _ = seeded_dir
    r = TestClient(create_app(data_dir)).get("/api/spx/playbook")
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_playbook_route_serves_stored(seeded_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, store = seeded_dir
    store.upsert_spx_playbook("2026-07-07", {"session": "2026-07-08",
                                             "level_ladder": [{"price": 7481, "kind": "gamma flip"}],
                                             "setups": [{"trigger": "above 7481"}]})
    r = TestClient(create_app(data_dir)).get("/api/spx/playbook")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["session"] == "2026-07-08"
    assert body["scaffold"]["level_ladder"][0]["price"] == 7481


def test_pine_route_empty_when_no_playbook(seeded_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, _ = seeded_dir
    r = TestClient(create_app(data_dir)).get("/api/spx/playbook/pine")
    assert r.status_code == 200
    assert r.json()["available"] is False


def test_pine_route_renders_stored_scaffold(seeded_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, store = seeded_dir
    store.upsert_spx_playbook("2026-07-07", {
        "session": "2026-07-08", "generated_for": "2026-07-07",
        "regime": {"gamma": "positive"},
        "level_ladder": [
            {"price": 7550.0, "kind": "GEX call wall (resistance)"},
            {"price": 7481.0, "kind": "gamma flip (regime line)"},
            {"price": 7450.0, "kind": "GEX put wall (support)"}],
        "setups": [{"trigger": "above flip",
                    "levels": {"flip": 7481.0, "put_wall": 7450.0, "call_wall": 7550.0}}],
    })
    r = TestClient(create_app(data_dir)).get("/api/spx/playbook/pine")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["session"] == "2026-07-08"
    assert body["script"].startswith("//@version=5")
    assert "flipLevel = 7481.0" in body["script"]
    assert "NOT FINANCIAL ADVICE" in body["script"]


def _seed_spx_ticket_playbook(store):
    store.upsert_spx_playbook("2026-07-07", {
        "session": "2026-07-08", "generated_for": "2026-07-07",
        "regime": {"gamma": "positive", "spot": 7481.0},
        "level_ladder": [
            {"price": 7550.0, "kind": "call wall", "source": "GEX"},
            {"price": 7481.0, "kind": "gamma flip", "source": "GEX"},
            {"price": 7450.0, "kind": "put wall", "source": "GEX"}],
        "setups": [],
    })


def test_ticket_route_stages_index_trade_in_the_proxy_etf(seeded_dir, monkeypatch):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, store = seeded_dir
    _seed_spx_ticket_playbook(store)
    # SPX is an index — the ticket must come back in SPY, rescaled by the live
    # ratio. Mock the SPY quote: 748.10 vs index spot 7481.0 -> ratio 0.1.
    from vantage_server import quotes as q
    monkeypatch.setattr(q, "_yf_fetch", lambda syms, timeout=15.0: {"SPY": (748.10, 747.0)})
    client = TestClient(create_app(data_dir))
    r = client.get("/api/ticket", params={
        "symbol": "SPX", "side": "long", "level": 7481.0, "risk": 500.0})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    tk = body["ticket"]
    assert tk["symbol"] == "SPY"                    # staged in the tradeable proxy
    assert tk["orders"]["entry"]["price"] == 748.1  # 7481 * 0.1
    # ladder rescaled too: 7550 -> 755.0
    assert [t["price"] for t in tk["orders"]["targets"]] == [755.0]
    assert tk["risk"]["max_loss_at_stop"] <= 500.0
    # provenance records the mapping for operator verification
    assert tk["derived_from"]["index"] == "SPX"
    assert tk["derived_from"]["index_level"] == 7481.0
    assert abs(tk["derived_from"]["ratio"] - 0.1) < 1e-9
    assert "STAGED ONLY" in tk["note"]
    assert "LONG SPY" in body["text"] and "from SPX 7481.0" in body["text"]


def test_ticket_route_index_without_proxy_quote_degrades(seeded_dir, monkeypatch):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, store = seeded_dir
    _seed_spx_ticket_playbook(store)
    from vantage_server import quotes as q
    monkeypatch.setattr(q, "_yf_fetch", lambda syms, timeout=15.0: {})  # no quote
    r = TestClient(create_app(data_dir)).get("/api/ticket", params={
        "symbol": "SPX", "side": "long", "level": 7481.0})
    body = r.json()
    assert body["available"] is False               # no ticket on a guessed ratio
    assert "not directly buyable" in body["note"]


def test_ticket_route_tradeable_symbol_needs_no_proxy(seeded_dir):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    data_dir, store = seeded_dir
    store.upsert_spx_playbook("2026-07-07", {
        "session": "2026-07-08", "generated_for": "2026-07-07",
        "regime": {"gamma": "positive", "spot": 500.0},
        "level_ladder": [
            {"price": 505.0, "kind": "call wall", "source": "GEX"},
            {"price": 495.0, "kind": "put wall", "source": "GEX"}],
        "setups": [],
    }, symbol="QQQ")
    r = TestClient(create_app(data_dir)).get("/api/ticket", params={
        "symbol": "QQQ", "side": "long", "level": 495.0, "risk": 200.0})
    body = r.json()
    assert body["available"] is True
    tk = body["ticket"]
    assert tk["symbol"] == "QQQ" and tk["derived_from"] is None   # direct, no rescale
    assert tk["orders"]["entry"]["price"] == 495.0
    # bad input degrades honestly, no ticket
    bad = TestClient(create_app(data_dir)).get("/api/ticket", params={
        "symbol": "QQQ", "side": "sideways", "level": 495.0})
    assert bad.json()["available"] is False


def test_recompute_route_regenerates_and_stores(seeded_dir, sentinel_dir, monkeypatch):
    from fastapi.testclient import TestClient
    from vantage_server.api import create_app
    from vantage_server import spx_playbook as pb
    data_dir, store = seeded_dir
    # stub the bar fetches so recompute doesn't hit Yahoo
    monkeypatch.setattr(pb, "_fetch_15m", lambda sym: _fake_15m(days=12))
    r = TestClient(create_app(data_dir)).post(
        "/api/spx/playbook/recompute", json={"as_of": "2026-07-07"})
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["date"] == "2026-07-07"
    # it persisted — a subsequent GET serves it
    got = store.load_spx_playbook("2026-07-07")
    assert got is not None and got["scaffold"]["symbol"] == "SPX"
