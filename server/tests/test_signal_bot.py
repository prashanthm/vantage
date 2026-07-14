"""The reclaim signal bot: telegram wiring (log-only unconfigured, correct
Bot-API payload configured), session arming (reclaim tickets only, idempotent
dedupe), and the poll transition diff (armed / reclaim_confirmed / closed /
expired → one push each). Fully offline: paper pipeline + urllib stubbed."""
from __future__ import annotations

import datetime as _dt
import json

import pytest

from vantage_server import paper, signal_bot


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


@pytest.fixture()
def sent(monkeypatch):
    """Capture every outbound telegram message."""
    out: list[str] = []
    monkeypatch.setattr(signal_bot, "send_telegram",
                        lambda text, store=None: (out.append(text), True)[1])
    return out


# ------------------------------------------------------------- telegram

def test_unconfigured_telegram_is_log_only(monkeypatch):
    monkeypatch.delenv(signal_bot.TOKEN_ENV, raising=False)
    monkeypatch.delenv(signal_bot.CHAT_ENV, raising=False)

    def boom(*a, **k):  # pragma: no cover
        raise AssertionError("network must not be touched unconfigured")
    monkeypatch.setattr("urllib.request.urlopen", boom)
    assert signal_bot.send_telegram("hello") is False


def test_configured_telegram_posts_bot_api_payload(monkeypatch):
    monkeypatch.setenv(signal_bot.TOKEN_ENV, "TOK123")
    monkeypatch.setenv(signal_bot.CHAT_ENV, "42")
    captured = {}

    class FakeRes:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode())
        return FakeRes()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    assert signal_bot.send_telegram("reclaim!") is True
    assert captured["url"] == "https://api.telegram.org/botTOK123/sendMessage"
    assert captured["body"]["chat_id"] == "42"
    assert captured["body"]["text"] == "reclaim!"


# ------------------------------------------------------------- arming

def _wire_playbook(monkeypatch, store, tickets, session="2026-07-13"):
    """Point the bot at a fake playbook + ticket build for SPX only."""
    monkeypatch.setattr(signal_bot, "BOT_UNDERLYINGS", ("SPX",))
    monkeypatch.setattr(store, "load_spx_playbook",
                        lambda symbol=None, day=None: {"scaffold": {"x": 1},
                                                       "session": session},
                        raising=False)
    monkeypatch.setattr(paper, "build_analysis",
                        lambda st, scaffold, underlying="SPX": {"tickets": tickets})


def _ticket(level=623.2, side="long", trigger="reclaim-3x5m"):
    return {"signal": f"{side} reclaim {level}", "side": side, "symbol": "SPY",
            "spy_entry": level, "spy_target": 625.3, "spy_stop": 622.15,
            "spy_level": level, "entry_trigger": trigger,
            "entry_note": "3x5m closes"}


def test_arm_session_opens_reclaim_tickets_only_and_dedupes(tmp_path, monkeypatch, sent):
    store = _sqlite_store(tmp_path)
    _wire_playbook(monkeypatch, store, [
        _ticket(623.2, "long"),
        _ticket(628.4, "short"),
        _ticket(600.0, "long", trigger=None),      # touch ticket — not a signal
    ])
    opened = signal_bot.arm_session(store)
    assert len(opened) == 2
    rows = store.load_paper_trades("open")
    assert all(r["source"] == "auto" for r in rows)
    assert all((r.get("fill_status") or "") == "pending" for r in rows)
    assert len(sent) == 1 and "reclaim levels armed" in sent[0]
    assert "623.2" in sent[0] and "628.4" in sent[0]

    # idempotent: nothing new, nothing pushed
    assert signal_bot.arm_session(store) == []
    assert len(sent) == 1
    assert len(store.load_paper_trades("open")) == 2


# ------------------------------------------------------------- poll diff

def test_poll_pushes_on_fill_close_and_expiry(tmp_path, monkeypatch, sent):
    store = _sqlite_store(tmp_path)
    _wire_playbook(monkeypatch, store, [_ticket(623.2, "long"),
                                        _ticket(628.4, "short"),
                                        _ticket(631.0, "short")])
    ids = [r["id"] for r in signal_bot.arm_session(store)]
    sent.clear()

    def fake_settle(st):
        st.fill_paper_trade(ids[0], spy_entry=623.45, filled_at="2026-07-13T10:05:00")
        st.fill_paper_trade(ids[1], spy_entry=628.1, filled_at="2026-07-13T10:10:00")
        st.close_paper_trade(ids[1], spy_exit=626.0, exit_reason="target",
                             pnl=210.0, pnl_pct=0.33,
                             closed_at="2026-07-13T11:00:00")
        st.close_paper_trade(ids[2], spy_exit=0.0, exit_reason="never_filled",
                             pnl=0.0, pnl_pct=0.0, closed_at="2026-07-13T16:00:00")
        return {"checked": 3, "filled": 2, "expired": 1, "closed": 1}

    monkeypatch.setattr(paper, "settle_open", fake_settle)
    events = signal_bot.poll(store)
    kinds = sorted(e["kind"] for e in events)
    # one fill still open, one fill+close in the same pass, one expiry
    assert kinds == ["closed", "expired", "reclaim_confirmed", "reclaim_confirmed"]
    texts = "\n".join(sent)
    assert "RECLAIM CONFIRMED — LONG SPY @ 623.45" in texts
    assert "RECLAIM CONFIRMED — SHORT SPY @ 628.1" in texts
    assert "✅" in texts and "target" in texts and "+210.00" in texts
    assert "expired unfilled" in texts


def test_poll_quiet_when_nothing_changes(tmp_path, monkeypatch, sent):
    store = _sqlite_store(tmp_path)
    _wire_playbook(monkeypatch, store, [_ticket(623.2, "long")])
    signal_bot.arm_session(store)
    sent.clear()
    monkeypatch.setattr(paper, "settle_open",
                        lambda st: {"checked": 1, "filled": 0, "expired": 0,
                                    "closed": 0})
    assert signal_bot.poll(store) == []
    assert sent == []


# ------------------------------------------------------------- hours gate

def test_market_open_now_gates_weekends_and_nights():
    et = paper.ET
    assert signal_bot.market_open_now(_dt.datetime(2026, 7, 13, 10, 0, tzinfo=et))   # Mon 10am
    assert not signal_bot.market_open_now(_dt.datetime(2026, 7, 12, 10, 0, tzinfo=et))  # Sun
    assert not signal_bot.market_open_now(_dt.datetime(2026, 7, 13, 20, 30, tzinfo=et))  # night
    assert signal_bot.market_open_now(_dt.datetime(2026, 7, 13, 9, 25, tzinfo=et))
    assert not signal_bot.market_open_now(_dt.datetime(2026, 7, 13, 16, 11, tzinfo=et))


# ------------------------------------------------------------- store creds

def test_store_creds_fallback_and_env_priority(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    monkeypatch.delenv(signal_bot.TOKEN_ENV, raising=False)
    monkeypatch.delenv(signal_bot.CHAT_ENV, raising=False)
    assert signal_bot.telegram_creds(store) == (None, None, "unconfigured")

    store.set_meta(signal_bot.TOKEN_META, "STORETOK")
    store.set_meta(signal_bot.CHAT_META, "99")
    assert signal_bot.telegram_creds(store) == ("STORETOK", "99", "store")
    assert signal_bot.telegram_configured(store)

    monkeypatch.setenv(signal_bot.TOKEN_ENV, "ENVTOK")
    monkeypatch.setenv(signal_bot.CHAT_ENV, "11")
    assert signal_bot.telegram_creds(store) == ("ENVTOK", "11", "env")


# ------------------------------------------------------------- correlation

def _seed_signal(store, *, side="long", level=623.2, closed=False):
    tid = store.record_paper_trade({
        "opened_at": "2026-07-13T09:40:00-04:00", "session": "2026-07-13",
        "signal": f"{side} reclaim {level}", "side": side, "symbol": "SPY",
        "spy_entry": level, "spy_target": 625.3, "spy_stop": 622.15,
        "shares": 100, "source": "auto", "status": "open",
        "opened_price_src": "pending reclaim-3x5m",
        "entry_trigger": "reclaim-3x5m", "spy_level": level,
        "fill_status": "pending",
    })
    if closed:
        store.fill_paper_trade(tid, spy_entry=level + 0.25,
                               filled_at="2026-07-13T10:05:00-04:00")
        store.close_paper_trade(tid, spy_exit=625.3, exit_reason="target",
                                pnl=185.0, pnl_pct=0.3,
                                closed_at="2026-07-13T11:20:00-04:00")
    return tid


def _seed_live(store, *, signal_paper_id=None, side="long", closed=True):
    pid = store.record_managed_position({
        "opened_at": "2026-07-13T10:06:00+00:00", "account_number": "A",
        "symbol": "SPY", "side": side, "qty": 5.0, "entry_order_id": "e",
        "entry_price": 623.5, "initial_stop": 622.15, "stop_price": 622.15,
        "stop_order_id": "s", "exit_policy": "ladder", "target_price": 625.3,
        "high_water": 623.5, "status": "closed" if closed else "active",
        "last_checked": None, "note": "t", "signal_paper_id": signal_paper_id,
    })
    if closed:
        store.update_managed_position(pid, status="closed",
                                      exit_reason="target", exit_price=625.3,
                                      closed_at="2026-07-13T11:20:00+00:00")
    return pid


def test_performance_joins_explicit_link_first(tmp_path):
    store = _sqlite_store(tmp_path)
    sig = _seed_signal(store, closed=True)
    _seed_live(store, signal_paper_id=sig)
    perf = signal_bot.performance(store)
    row = perf["rows"][0]
    assert row["signal"]["paper_id"] == sig
    assert row["live"]["linked"] is True
    assert row["live"]["pnl"] == pytest.approx(9.0)   # (625.3-623.5)*5
    s = perf["summary"]
    assert s["signals"] == 1 and s["live_taken"] == 1
    assert s["paper_win_rate"] == 1.0 and s["paper_pnl"] == 185.0
    assert s["live_pnl"] == pytest.approx(9.0)


def test_performance_fallback_match_is_flagged_approximate(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_signal(store, closed=True)
    _seed_live(store, signal_paper_id=None)   # same symbol/side/date, no link
    perf = signal_bot.performance(store)
    assert perf["rows"][0]["live"]["linked"] is False
    assert perf["summary"]["live_taken"] == 1


def test_performance_untaken_signal_has_no_live(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_signal(store, closed=True)
    _seed_signal(store, side="short", level=628.4)   # still pending, untaken
    perf = signal_bot.performance(store)
    assert [r["live"] for r in perf["rows"]] == [None, None]
    assert perf["summary"]["live_taken"] == 0


def test_arm_dedupes_when_proxy_ratio_drifts(tmp_path, monkeypatch, sent):
    """Live 2026-07-13 regression: SPX tickets carry a stable spx_level but a
    spy_level that drifts with the live proxy ratio — dedupe must key on the
    underlying level or every poll re-arms (and re-notifies) the same signal."""
    store = _sqlite_store(tmp_path)

    def drifting(level_spy):
        t = _ticket(level_spy, "long")
        t["spx_level"] = 7555.1          # stable underlying identity
        return t

    _wire_playbook(monkeypatch, store, [drifting(748.43)])
    assert len(signal_bot.arm_session(store)) == 1

    # next poll: the live ratio moved, spy terms shifted — SAME signal
    _wire_playbook(monkeypatch, store, [drifting(748.27)])
    assert signal_bot.arm_session(store) == []
    assert len(store.load_paper_trades("open")) == 1
    assert len(sent) == 1


# ------------------------------------------------------------- nightly digest

def test_nightly_report_summarizes_today(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(store, "load_spx_playbook",
                        lambda symbol=None, day=None: (
                            {"session": _dt.datetime.now(paper.ET).date().isoformat()}
                            if symbol in ("SPX", "QQQ") else None),
                        raising=False)
    today = _dt.datetime.now(paper.ET).date().isoformat()
    win = _seed_signal(store)
    store.fill_paper_trade(win, spy_entry=623.45, filled_at=f"{today}T10:05:00")
    store.close_paper_trade(win, spy_exit=625.3, exit_reason="target",
                            pnl=185.0, pnl_pct=0.3, closed_at=f"{today}T11:20:00")
    riding = _seed_signal(store, side="short", level=628.4)
    store.fill_paper_trade(riding, spy_entry=628.1, filled_at=f"{today}T13:40:00")
    _seed_signal(store, side="long", level=618.0)          # still armed
    _seed_live(store, signal_paper_id=win, closed=False)   # live book open

    text = signal_bot.nightly_report(store)
    assert "🌙 Vantage nightly" in text
    assert "SPX ✓" in text and "QQQ ✓" in text and "IWM ✗" in text
    assert "2 fired" in text and "1✅ 0❌" in text and "+185.00" in text
    assert "1 riding · 1 armed" in text
    assert "1 open managed" in text
    assert "✅ SPY long target +185.00" in text


# ------------------------------------------------------------- nightly runs

def test_nightly_run_roundtrip_and_digest_jobs_line(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(store, "load_spx_playbook",
                        lambda symbol=None, day=None: None, raising=False)
    today = _dt.datetime.now(paper.ET)
    rid = store.record_nightly_run({
        "started_at": today.isoformat(), "finished_at": today.isoformat(),
        "variant": "docker",
        "jobs": [
            {"job": "EOD bar snapshot", "ok": True, "duration_sec": 41, "tail": "wrote 12"},
            {"job": "GEX snapshot (SPX)", "ok": False, "duration_sec": 3,
             "tail": "boom\nchain fetch failed"},
        ]})
    runs = store.load_nightly_runs()
    assert runs[0]["id"] == rid and len(runs[0]["jobs"]) == 2
    assert runs[0]["jobs"][1]["ok"] is False

    text = signal_bot.nightly_report(store)
    assert "Jobs: 1✓ 1✗ (0m44s)" in text
    assert "✗ GEX snapshot (SPX): chain fetch failed" in text


def test_digest_skips_stale_nightly_run(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr(store, "load_spx_playbook",
                        lambda symbol=None, day=None: None, raising=False)
    store.record_nightly_run({
        "started_at": "2020-01-01T18:00:00", "finished_at": "2020-01-01T18:04:00",
        "variant": "docker",
        "jobs": [{"job": "old", "ok": True, "duration_sec": 1, "tail": ""}]})
    assert "Jobs:" not in signal_bot.nightly_report(store)
