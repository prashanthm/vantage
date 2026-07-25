"""Level-cross alerts: arm records the side, tick fires exactly once on a
cross, re-arming replaces a fired twin. Telegram is stubbed out."""
from vantage_server import level_alerts as la


class _S:
    """Meta-kv + intraday-bar stub. `px` drives the 'last print'."""
    uses_sqlite = True

    def __init__(self, px):
        self.px = px
        self.meta = {}

    def get_meta(self, k):
        return self.meta.get(k)

    def set_meta(self, k, v):
        self.meta[k] = v

    def latest_intraday_day(self, symbol, interval="1m"):
        return "2026-07-24"

    def load_intraday_bars(self, symbol, day, interval):
        return [{"close": self.px}]


def test_alert_arms_with_side_and_fires_once(monkeypatch):
    sent = []
    monkeypatch.setattr(la, "_last_price", lambda store, sym: store.px)
    import vantage_server.signal_bot as sb
    monkeypatch.setattr(sb, "send_telegram", lambda text, store=None: sent.append(text) or True)
    monkeypatch.setattr(sb, "telegram_configured", lambda store=None: True)

    s = _S(px=7400.0)
    a = la.add_alert(s, "SPX", 7424.4, "durable resistance")
    assert a["side"] == "below"                       # price under the level at arm

    assert la.tick(s) == []                           # 7400 — no cross yet
    s.px = 7430.0
    fired = la.tick(s)                                # crossed up through 7424.4
    assert len(fired) == 1 and fired[0]["fired_price"] == 7430.0
    assert len(sent) == 1 and "SPX" in sent[0] and "7424.4" in sent[0]

    assert la.tick(s) == []                           # one-shot: no refire
    # re-arm same level: replaces the fired twin, new side is ABOVE now
    b = la.add_alert(s, "SPX", 7424.4)
    assert b["side"] == "above"
    assert len(la.list_alerts(s)) == 1

    assert la.remove_alert(s, b["id"]) is True
    assert la.list_alerts(s) == []
