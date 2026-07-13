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
                        lambda text: (out.append(text), True)[1])
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
