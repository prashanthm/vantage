"""Paper trading: SPX→SPY translation, ticket generation, settle target/stop, stats."""
from __future__ import annotations

import datetime as _dt

import pandas as pd

from vantage_server import paper


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


# ------------------------------------------------------------ translation

def test_to_spy_and_nearest_strike():
    assert paper.to_spy(7547.0, 10.0) == 754.7
    assert paper.nearest_strike(754.61) == 755.0
    assert paper.nearest_strike(754.4) == 754.0


# ------------------------------------------------------------ tickets

def _scaffold():
    return {
        "regime": {"spot": 7543.0},
        "confluence": [
            {"price": 7547.0, "role": "resistance", "kinds": ["resistance", "round"]},
            {"price": 7500.0, "role": "support", "kinds": ["fib", "max_pain"]},
            {"price": 7473.0, "role": "support", "kinds": ["support", "flip"]},
        ],
    }


# a fixed ET time + a quiet session range keep ticket tests network-free and
# deterministic (no live fetch, no break setups unless a test opts in).
_NOON = _dt.datetime(2026, 7, 10, 10, 0, tzinfo=paper.ET)
_QUIET = (7540.0, 7548.0, 7543.0)   # range hugging spot — breaks nothing


def _qqq_scaffold():
    return {
        "regime": {"spot": 500.0},
        "confluence": [
            {"price": 505.0, "role": "resistance", "kinds": ["resistance"]},
            {"price": 495.0, "role": "support", "kinds": ["fib"]},
        ],
    }


def test_qqq_tickets_self_proxy_ratio_one():
    """QQQ is its own proxy: ratio 1, entries at the QQQ level itself, symbol=QQQ,
    OTM strike in QQQ dollars (a few $ off, not SPX-scaled)."""
    qr = (498.0, 506.0, 502.0)   # quiet-ish range; nothing broken through
    tickets = paper.build_tickets(_qqq_scaffold(), spy_price=500.0, ratio=1.0,
                                  session_range=qr, now_et=_NOON, underlying="QQQ")
    short = next(t for t in tickets if t["side"] == "short" and t["setup"] == "test")
    assert short["symbol"] == "QQQ" and short["underlying"] == "QQQ"
    assert short["spy_entry"] == 505.0                 # entry AT the QQQ level
    assert short["spy_stop"] > 505.0 > short["spy_target"]
    # OTM put strike is below entry and within a few dollars (not 25 pts SPX-style)
    assert 500.0 < short["otm_strike"] < 505.0


def test_build_tickets_entry_at_level_and_rr():
    tickets = paper.build_tickets(_scaffold(), spy_price=754.3, ratio=10.0,
                                  session_range=_QUIET, now_et=_NOON)
    # a resistance above spot → fade rally (short); supports below → buy dip (long)
    shorts = [t for t in tickets if t["side"] == "short"]
    longs = [t for t in tickets if t["side"] == "long"]
    assert shorts and longs
    s = shorts[0]
    # entry is AT the level (7547 → 754.70), not at spot; stop above, target below
    assert s["spy_entry"] == 754.7
    assert s["spy_stop"] > s["spy_entry"] > s["spy_target"]
    assert s["reward_risk"] and s["reward_risk"] > 0
    long0 = longs[0]
    assert long0["spy_stop"] < long0["spy_entry"] < long0["spy_target"]


def test_no_tickets_without_confluence():
    assert paper.build_tickets({"regime": {"spot": 7543}, "confluence": []}, 754, 10,
                               session_range=_QUIET, now_et=_NOON) == []


# ------------------------------------------------------- demand/supply enrich

def test_trend_filter_flags_counter_trend(monkeypatch):
    # test the counter_trend FLAG in isolation (gate off, so both sides survive)
    monkeypatch.setattr(paper, "DIRECTION_GATE", False)
    sc = _scaffold()
    sc["chart"] = {"structure": {"state": "uptrend"}}
    sc["regime"]["gamma"] = "negative"
    tickets = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=_NOON)
    short = next(t for t in tickets if t["side"] == "short" and t["setup"] == "test")
    long_ = next(t for t in tickets if t["side"] == "long" and t["setup"] == "test")
    assert short["counter_trend"] is True      # fade-rally fights the uptrend
    assert long_["counter_trend"] is False     # buy-dip aligns with the uptrend


def test_positive_gamma_is_never_counter_trend(monkeypatch):
    monkeypatch.setattr(paper, "DIRECTION_GATE", False)
    sc = _scaffold()
    sc["chart"] = {"structure": {"state": "uptrend"}}
    sc["regime"]["gamma"] = "positive"          # mean-revert regime → reversion ok
    tickets = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=_NOON)
    assert all(t["counter_trend"] is False for t in tickets)


def test_direction_gate_drops_counter_trend_in_a_clear_trend():
    # coach-edge fix: in a clear uptrend the pipeline drops SHORT tests entirely
    # (with-trend only), keeping longs. Range/transition would allow both.
    sc = _scaffold()
    sc["chart"] = {"structure": {"state": "uptrend"}}
    tickets = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=_NOON)
    assert tickets, "expected with-trend tickets to survive"
    assert all(t["side"] == "long" for t in tickets)


def test_break_setup_on_closed_through_resistance():
    sc = _scaffold()
    # price ran to 7560 and closed 7555 → 7547 resistance BROKEN → break long
    rng = (7540.0, 7560.0, 7555.0)
    tickets = paper.build_tickets(sc, 754.3, 10.0, session_range=rng, now_et=_NOON)
    breaks = [t for t in tickets if t["setup"] == "break"]
    assert len(breaks) == 1
    b = breaks[0]
    assert b["side"] == "long" and b["experts_only"] is True
    assert b["spx_level"] == 7547.0
    assert "breakout retest" in b["signal"]


def test_no_break_setup_when_range_quiet():
    tickets = paper.build_tickets(_scaffold(), 754.3, 10.0,
                                  session_range=_QUIET, now_et=_NOON)
    assert all(t["setup"] == "test" for t in tickets)


def test_zone_freshness_from_durable():
    sc = _scaffold()
    sc["durable"] = [
        {"price": 7500.0, "lo": 7498.0, "hi": 7502.0, "sessions": 8, "respected": 6, "role": "support"},
        {"price": 7473.0, "lo": 7471.0, "hi": 7475.0, "sessions": 8, "respected": 1, "role": "support"},
    ]
    tickets = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=_NOON)
    by_lvl = {t["spx_level"]: t for t in tickets if t["setup"] == "test"}
    assert by_lvl[7500.0]["freshness"] == "strong"   # respected 6/8
    assert by_lvl[7473.0]["freshness"] == "weak"     # respected 1/8
    assert by_lvl[7547.0]["freshness"] == "fresh"    # no durable match


def test_otm_strike_time_of_day_and_direction():
    sc = _scaffold()
    morning = _dt.datetime(2026, 7, 10, 10, 0, tzinfo=paper.ET)     # 9am CST
    afternoon = _dt.datetime(2026, 7, 10, 15, 0, tzinfo=paper.ET)   # 2pm CST
    t_am = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=morning)
    t_pm = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=afternoon)
    long_am = next(t for t in t_am if t["side"] == "long" and t["setup"] == "test")
    long_pm = next(t for t in t_pm if t["side"] == "long" and t["setup"] == "test")
    # wider OTM in the morning than the afternoon; call OTM is ABOVE entry
    assert long_am["otm_strike"] - long_am["spy_entry"] > long_pm["otm_strike"] - long_pm["spy_entry"]
    assert long_am["otm_strike"] > long_am["spy_entry"]
    short_am = next(t for t in t_am if t["side"] == "short" and t["setup"] == "test")
    assert short_am["otm_strike"] < short_am["spy_entry"]   # put OTM is BELOW entry


def test_suppress_counter_trend_toggle(monkeypatch):
    sc = _scaffold()
    sc["chart"] = {"structure": {"state": "uptrend"}}
    sc["regime"]["gamma"] = "negative"
    monkeypatch.setattr(paper, "SUPPRESS_COUNTER_TREND", True)
    tickets = paper.build_tickets(sc, 754.3, 10.0, session_range=_QUIET, now_et=_NOON)
    assert all(t["counter_trend"] is False for t in tickets)   # counter-trend dropped


# ------------------------------------------------------------ open + settle

def test_open_and_settle_target_hit(tmp_path):
    store = _sqlite_store(tmp_path)
    tid = paper.open_paper_trade(store, {
        "signal": "buy dip 750", "side": "long", "spx_level": 7500,
        "spy_entry": 750.0, "spy_target": 755.0, "spy_stop": 748.0, "shares": 100,
        "ref_strike": 750}, now=_dt.datetime(2026, 7, 10, 10, 0))
    assert tid and len(store.load_paper_trades("open")) == 1
    idx = pd.to_datetime(["2026-07-10 10:15", "2026-07-10 10:30"])
    bars = pd.DataFrame({"High": [752, 756], "Low": [749, 753], "Close": [751, 755]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "target" and res["spy_exit"] == 755.0
    assert res["pnl"] == 500.0            # (755-750)*100


def test_settle_stop_hit_short(tmp_path):
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "fade 760", "side": "short", "spx_level": 7600,
        "spy_entry": 760.0, "spy_target": 755.0, "spy_stop": 762.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    idx = pd.to_datetime(["2026-07-10 10:15"])
    bars = pd.DataFrame({"High": [763], "Low": [759], "Close": [762]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "stop" and res["spy_exit"] == 762.0
    assert res["pnl"] == -200.0           # short: (762-760)*-1*100


def test_settle_ignores_bars_before_open(tmp_path):
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "buy 750", "side": "long", "spy_entry": 750.0,
        "spy_target": 755.0, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    # a bar BEFORE the open touched the target — must be ignored
    idx = pd.to_datetime(["2026-07-10 09:00", "2026-07-10 10:15"])
    bars = pd.DataFrame({"High": [760, 751], "Low": [740, 749], "Close": [755, 750]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res is None                    # neither target nor stop hit AFTER open


def test_settle_eod_closes_at_fill_day_last_bar(tmp_path):
    """Day-trade discipline (open-ended-edge goal): a WITH-TARGET trade that
    survives to the next session closes at the fill day's LAST bar, not
    wherever the overnight ride ends. (Open-ended trades exit earlier — the
    15:45 cutoff — covered by test_settle_open_ended_flat_by_1545.)"""
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "buy 750", "side": "long", "spy_entry": 750.0,
        "spy_target": 760.0, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    # survives Jul 10 (never touches 748), gaps down Jul 13 — old code stopped
    # at 748 next day; new code exits at Jul 10's last close 751.0
    idx = pd.to_datetime(["2026-07-10 10:15", "2026-07-10 15:45",
                          "2026-07-13 09:30"])
    bars = pd.DataFrame({"High": [752, 751.5, 749], "Low": [749, 750.5, 745],
                         "Close": [751.5, 751.0, 746]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "eod" and res["spy_exit"] == 751.0
    assert res["pnl"] == 100.0            # (751-750)*100
    assert res["closed_at"].startswith("2026-07-10")


def test_settle_open_ended_flat_by_1545(tmp_path):
    """Runners (target=None) exit at the 15:45 mark — the first bar stamped
    ≥15:45 closes them at the prior bar's close. With-target trades keep the
    last-bar close (frozen-tape split verdict, 2026-07-24)."""
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "runner 750", "side": "long", "spy_entry": 750.0,
        "spy_target": None, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    idx = pd.to_datetime(["2026-07-10 15:35", "2026-07-10 15:40",
                          "2026-07-10 15:45", "2026-07-10 15:55"])
    bars = pd.DataFrame({"High": [751, 751.5, 753, 754], "Low": [749, 750, 752, 753],
                         "Close": [750.8, 751.2, 752.8, 753.9]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "eod" and res["spy_exit"] == 751.2   # 15:40 bar close
    assert res["pnl"] == 120.0            # (751.2-750)*100 — NOT the 753.9 last bar
    # a with-target trade on the same tape rides past 15:45 (target hit at 15:45 bar)
    tid2 = paper.open_paper_trade(store, {
        "signal": "buy 750", "side": "long", "spy_entry": 750.0,
        "spy_target": 752.5, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    t2 = [t for t in store.load_paper_trades("open") if t["id"] == tid2][0]
    res2 = paper._settle_one(t2, bars)
    assert res2["exit_reason"] == "target" and res2["spy_exit"] == 752.5


def test_settle_eod_same_evening_when_session_complete(tmp_path):
    store = _sqlite_store(tmp_path)
    paper.open_paper_trade(store, {
        "signal": "fade 760", "side": "short", "spy_entry": 760.0,
        "spy_target": 750.0, "spy_stop": 762.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    # the 15:55 bar is the session's last — settle that evening, no overnight
    idx = pd.to_datetime(["2026-07-10 10:15", "2026-07-10 15:55"])
    bars = pd.DataFrame({"High": [761, 759.5], "Low": [758, 758.5],
                         "Close": [759, 758.8]}, index=idx)
    res = paper._settle_one(store.load_paper_trades("open")[0], bars)
    assert res["exit_reason"] == "eod" and res["spy_exit"] == 758.8
    assert res["pnl"] == 120.0            # short: (758.8-760)*-1*100
    # mid-session it must stay open (no premature eod)
    res_mid = paper._settle_one(store.load_paper_trades("open")[0], bars.iloc[:1])
    assert res_mid is None


def test_close_manually_and_stats(tmp_path):
    store = _sqlite_store(tmp_path)
    tid = paper.open_paper_trade(store, {
        "signal": "buy 750", "side": "long", "spy_entry": 750.0,
        "spy_target": 755.0, "spy_stop": 748.0, "shares": 100},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    assert paper.close_manually(store, tid, 753.0, now=_dt.datetime(2026, 7, 10, 11, 0))
    closed = store.load_paper_trades("closed")
    assert len(closed) == 1 and closed[0]["exit_reason"] == "manual"
    assert closed[0]["pnl"] == 300.0
    stats = paper.paper_stats(closed)
    assert stats["n"] == 1 and stats["wins"] == 1 and stats["win_rate"] == 1.0


# ── reclaim discipline (F1): pending fill, streak reset, expiry ──────────────


def _pending_trade(store, side="long", level=750.0):
    # target +7 / stop -2 → R:R stays above the 1.5 floor even after the fill
    # moves the entry up to the reclaim close (coach-edge: MIN_REWARD_RISK=1.5).
    tgt = level + 7 if side == "long" else level - 7
    stop = level - 2 if side == "long" else level + 2
    return paper.open_paper_trade(store, {
        "signal": f"reclaim {level}", "side": side, "spx_level": level * 10,
        "spy_level": level, "spy_entry": level, "spy_target": tgt,
        "spy_stop": stop, "shares": 100,
        "entry_trigger": "reclaim-3x5m",
        "entry_note": "enter after 3 consecutive 5m closes back above"},
        now=_dt.datetime(2026, 7, 10, 10, 0))


def _bars5(closes, start="2026-07-10 10:05"):
    idx = pd.date_range(start, periods=len(closes), freq="5min")
    return pd.DataFrame({
        "High": [c + 0.5 for c in closes],
        "Low": [c - 0.5 for c in closes],
        "Close": closes}, index=idx)


def test_reclaim_ticket_opens_pending_not_filled(tmp_path):
    store = _sqlite_store(tmp_path)
    _pending_trade(store)
    t = store.load_paper_trades("open")[0]
    assert t["fill_status"] == "pending"
    assert t["entry_trigger"] == "reclaim-3x5m"
    assert t["filled_at"] is None


def test_try_fill_requires_three_consecutive_closes(tmp_path):
    store = _sqlite_store(tmp_path)
    _pending_trade(store)
    t = store.load_paper_trades("open")[0]
    # two closes above, one back below (reset), then only two above -> no fill
    assert paper._try_fill(t, _bars5([750.5, 750.8, 749.9, 750.4, 750.6])) is None
    # three consecutive closes above -> fill AT the third close
    fill = paper._try_fill(t, _bars5([750.5, 749.9, 750.2, 750.7, 751.1]))
    assert fill is not None
    assert fill["spy_entry"] == 751.1  # the confirming (3rd consecutive) close


def test_try_fill_short_side_needs_closes_below(tmp_path):
    store = _sqlite_store(tmp_path)
    _pending_trade(store, side="short", level=760.0)
    t = store.load_paper_trades("open")[0]
    fill = paper._try_fill(t, _bars5([759.8, 759.5, 759.2]))
    assert fill is not None and fill["spy_entry"] == 759.2


def test_settle_open_fills_then_settles_on_5m(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    _pending_trade(store)  # level 750, target 757, stop 748
    # fill at 3 consecutive closes above 750, then a bar tags the target
    bars = _bars5([750.4, 750.6, 750.9, 752.0, 758.0])
    monkeypatch.setattr(paper, "_fetch_proxy_5m", lambda proxy: bars)
    out = paper.settle_open(store)
    assert out["filled"] == 1 and out["closed"] == 1
    t = store.load_paper_trades("closed")[0]
    assert t["fill_status"] == "filled"
    assert t["spy_entry"] == 750.9          # reclaim close, NOT the touch level
    assert t["exit_reason"] == "target"
    assert t["opened_price_src"] == "reclaim 3x5m close"


def test_settle_open_expires_never_filled(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    _pending_trade(store)
    # 3 days of closes that never reclaim -> expired unfilled, pnl 0
    idx = pd.date_range("2026-07-10 10:05", periods=4, freq="1D")
    bars = pd.DataFrame({"High": [749.5] * 4, "Low": [748.5] * 4,
                         "Close": [749.0] * 4}, index=idx)
    monkeypatch.setattr(paper, "_fetch_proxy_5m", lambda proxy: bars)
    out = paper.settle_open(store)
    assert out["expired"] == 1 and out["closed"] == 0
    t = store.load_paper_trades("closed")[0]
    assert t["exit_reason"] == "never_filled" and t["pnl"] == 0.0


def test_tickets_still_carry_the_trigger_end_to_end(tmp_path):
    store = _sqlite_store(tmp_path)
    tid = paper.open_paper_trade(store, {
        "signal": "s", "side": "long", "spy_entry": 750.0, "spy_level": 750.0,
        "spy_target": 755.0, "spy_stop": 748.0, "shares": 100,
        "entry_trigger": "reclaim-3x5m", "entry_note": "note"},
        now=_dt.datetime(2026, 7, 10, 10, 0))
    t = store.load_paper_trades("open")[0]
    assert t["id"] == tid and t["entry_note"] == "note"


# ------------------------------------------------------------- live mirrors

def test_live_mirror_matching():
    """Manual broker spreads correlate onto their scanner paper rows: same
    underlying + option type, opened inside the arm window, nearest LONG strike
    (operator's width is free). One real position annotates one paper row."""
    from vantage_server.paper import _annotate_live_mirrors, _real_spread_positions

    class _S:
        def load_history(self):
            leg = lambda sym, side, qty, amt: {  # noqa: E731
                "kind": "option", "symbol": sym, "side": side, "quantity": qty,
                "amount": amt, "date": "2026-07-24T19:14:32Z",
                "position_effect": "open", "description": "long_call_spread open (debit)"}
            return [
                leg("BKR 2026-08-21 55C", "buy", 2.0, -850.0),
                leg("BKR 2026-08-21 65C", "sell", 2.0, 130.0),
                # $0-amount order events (canceled/replaced) must be ignored
                leg("BKR 2026-08-21 55C", "buy", 2.0, 0.0),
            ]

    reals = _real_spread_positions(_S())
    assert len(reals) == 1
    (r,) = reals
    assert r["strikes"] == [55.0, 65.0] and r["status"] == "open" and r["cost"] == 720.0

    mk = lambda long_k, short_k, setup: {  # noqa: E731
        "book": "scanner-spread", "structure": "debit_call_spread",
        "underlying": "BKR", "long_strike": long_k, "short_strike": short_k,
        "opened_at": "2026-07-24T18:56:00+00:00", "setup": setup, "status": "open"}
    ict, brk = mk(55.0, 60.0, "ict_htf"), mk(60.0, 65.0, "breakout_hold")
    rows = [ict, brk]
    _annotate_live_mirrors(rows, reals)
    # exact long-strike match (55) wins over the 60 breakout row
    assert ict.get("live") and ict["live"]["label"] == "BKR 55/65 ×2"
    assert "live" not in brk
    # the matched twin carries the real position's identity (Book provenance)
    assert ict["live"]["match"] == {"underlying": "BKR", "expiration": "2026-08-21",
                                    "kind": "C", "strikes": [55.0, 65.0]}


def test_live_mirror_unmatched_returned():
    """A real spread with no paper twin comes back from the matcher so a
    manual strategy tag (meta kv) can pick it up."""
    from vantage_server.paper import _annotate_live_mirrors, live_tag_key
    real = {"underlying": "MA", "expiration": "2026-07-24", "kind": "P",
            "strikes": [535.0, 545.0], "peak_qty": 4.0, "status": "closed",
            "opened_at": "2026-07-20T18:14:18Z", "realized": 1350.0, "cost": None}
    unmatched = _annotate_live_mirrors([], [real])
    assert unmatched == [real]
    assert live_tag_key(real) == "live_tag:MA:2026-07-24:P:535:545"
