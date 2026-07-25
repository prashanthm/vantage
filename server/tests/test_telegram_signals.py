"""Telegram signal pipeline (telegram_signals.py): the strict parse grammar,
coherence guard, idempotent ingest → paper trade in the 'telegram' book with
the CHANNEL as strategy tag, first-touch settlement, and the by-channel book.
No Telethon anywhere — the listener daemon is just transport."""
from __future__ import annotations

import pytest

from vantage_server import telegram_signals as tg
from vantage_server.store import Store, _SqliteBackend


@pytest.fixture
def store(tmp_path):
    s = Store(str(tmp_path))
    s._backend = _SqliteBackend(tmp_path, tmp_path / "vantage.db")
    return s


def test_parse_full_long_signal():
    sig = tg.parse_signal("BUY $NVDA entry 182.5 target 195 SL 176")
    assert sig == {"side": "long", "symbol": "NVDA", "entry": 182.5,
                   "stop": 176.0, "target": 195.0}


def test_parse_short_and_alias_keywords():
    sig = tg.parse_signal("SHORT TSLA @ 250 tp1: 238 stop loss: 257.5")
    assert sig["side"] == "short" and sig["symbol"] == "TSLA"
    assert sig["entry"] == 250 and sig["target"] == 238 and sig["stop"] == 257.5


def test_partial_or_incoherent_never_trades():
    assert tg.parse_signal("BUY AAPL looks great here!") is None          # no levels
    assert tg.parse_signal("AAPL entry 230 target 240 sl 225") is None    # no side
    # incoherent long (stop above entry) → refused
    assert tg.parse_signal("BUY $AAPL entry 230 target 240 SL 235") is None


def test_ingest_trades_dedupes_and_inboxes(store):
    r = tg.ingest_message(store, "alphachannel", 11,
                          "LONG $AMD entry 160 target 172 SL 154")
    assert r["status"] == "traded" and r["trade_id"]
    rows = store.load_paper_trades(status="open", book="telegram")
    assert len(rows) == 1 and rows[0]["setup"] == "alphachannel"
    assert rows[0]["shares"] == round(tg.NOTIONAL_USD / 160, 2)
    # same (channel, msg_id) again → duplicate, no second trade
    assert tg.ingest_message(store, "alphachannel", 11, "LONG $AMD entry 160 target 172 SL 154")["status"] == "duplicate"
    # same symbol re-pumped on a new msg → skipped while one is open
    assert tg.ingest_message(store, "alphachannel", 12, "LONG $AMD entry 161 target 175 SL 155")["status"] == "skipped-open"
    # chatter lands inbox-only
    assert tg.ingest_message(store, "alphachannel", 13, "huge day coming")["status"] == "inbox"
    assert len(store.load_paper_trades(status="open", book="telegram")) == 1
    assert [i["msg_id"] for i in tg.inbox(store)] == [13, 12, 11]   # newest first


def test_tick_settles_first_touch_stop_first(store):
    tg.ingest_message(store, "alpha", 1, "BUY $AMD entry 160 target 172 SL 154")
    tg.ingest_message(store, "alpha", 2, "SHORT $INTC entry 40 target 36 SL 42")
    # AMD rallies through target; INTC squeezes through its stop
    px = {"AMD": 173.0, "INTC": 42.5}
    acts = tg.tick(store, price_of=lambda s: px.get(s))
    got = {a["symbol"]: a["action"] for a in acts}
    assert got == {"AMD": "target", "INTC": "stop-loss"}
    book = tg.build_book(store)
    assert book["by_channel"]["alpha"]["n"] == 2
    assert book["by_channel"]["alpha"]["win_rate"] == 0.5


def test_channel_allowlist_roundtrip(store):
    assert tg.channels(store) == []
    assert tg.add_channel(store, "@alpha_signals") == ["alpha_signals"]
    assert tg.add_channel(store, "alpha_signals") == ["alpha_signals"]   # no dup
    assert tg.remove_channel(store, "alpha_signals") == []
