"""chain_recorder — the self-built option-chain archive (Alpaca data API).

Every RTH cron tick snapshots the 0DTE chain for the recorded underlyings and
appends it to ``chain_snaps``. In three months that's an intraday chain history
for exactly the symbols we trade, with known provenance — the dataset the
odte_research engines need and no vendor sells cheaply.

Read-only w.r.t. the world: this module GETs market data from the Alpaca DATA
host (data.alpaca.markets — no order endpoints exist there) and writes only to
our own store. Same allowlist doctrine as alpaca_broker: any path outside the
frozen prefix raises before I/O.

Alpaca carries no index options — SPX is NOT recordable here (SPY is the
recorded proxy). Feed defaults to 'indicative' (free tier); set
ALPACA_OPTIONS_FEED=opra if the account has the OPRA subscription.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import urllib.parse
import urllib.request

from .brokers.alpaca_broker import BrokerConnectionError, ReadOnlyViolation, _creds

DATA_BASE = "https://data.alpaca.markets"
#: the ONLY data-host path prefix this module will GET.
READ_PREFIXES = ("/v1beta1/options/snapshots/",)

#: what the cron records. SPX intentionally absent (not on Alpaca).
RECORD_UNDERLYINGS = ("SPY", "QQQ")

_OCC = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")


def _data_get(path: str, timeout: float = 20.0) -> dict:
    base = path.split("?", 1)[0]
    if not any(base.startswith(p) for p in READ_PREFIXES):
        raise ReadOnlyViolation(
            f"data path '{path}' outside the chain-recorder allowlist {READ_PREFIXES}")
    key, secret = _creds()
    req = urllib.request.Request(
        DATA_BASE + path,
        headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise BrokerConnectionError(f"Alpaca data {base} → HTTP {e.code}") from e
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise BrokerConnectionError(f"Alpaca data {base} unreachable: {e}") from e


def parse_occ(sym: str) -> dict | None:
    """SPY260720C00630000 → {underlying, expiry, right, strike}."""
    m = _OCC.match(sym or "")
    if not m:
        return None
    u, ymd, right, k = m.groups()
    return {"underlying": u, "expiry": f"20{ymd[:2]}-{ymd[2:4]}-{ymd[4:6]}",
            "right": right, "strike": int(k) / 1000.0}


def target_expiry(now: _dt.datetime | None = None) -> str:
    """The chain that matters: today (ET) during the session, else the next
    weekday's. SPY/QQQ list daily expiries, so this is normally a real chain;
    a date with no contracts just records 0 rows (harmless)."""
    et = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(
        _dt.timezone(_dt.timedelta(hours=-4)))  # ET (EDT); exactness not needed here
    d = et.date()
    if et.hour >= 16 and not (et.hour == 16 and et.minute <= 15):
        d += _dt.timedelta(days=1)
    while d.weekday() >= 5:                      # Sat/Sun → Monday
        d += _dt.timedelta(days=1)
    return d.isoformat()


def snapshot_chain(store, underlying: str, expiry: str | None = None) -> dict:
    """Fetch the full snapshot chain for one underlying+expiry and append every
    contract to chain_snaps. Returns {underlying, expiry, rows, source}."""
    feed = os.environ.get("ALPACA_OPTIONS_FEED", "indicative")
    exp = expiry or target_expiry()
    snapped_at = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    rows: list[tuple] = []
    token = None
    for _page in range(20):                       # 20 × 1000 contracts ≫ any 0DTE chain
        q = {"feed": feed, "limit": "1000", "expiration_date": exp}
        if token:
            q["page_token"] = token
        data = _data_get(f"/v1beta1/options/snapshots/{underlying.upper()}?"
                         + urllib.parse.urlencode(q))
        snaps = data.get("snapshots") or {}
        for sym, s in snaps.items():
            occ = parse_occ(sym)
            if not occ or occ["expiry"] != exp:
                continue
            quote = s.get("latestQuote") or {}
            greeks = s.get("greeks") or {}
            rows.append((
                snapped_at, f"alpaca-{feed}", occ["underlying"], exp,
                occ["right"], occ["strike"],
                quote.get("bp"), quote.get("ap"),
                (s.get("latestTrade") or {}).get("p"),
                s.get("impliedVolatility"),
                greeks.get("delta"), greeks.get("gamma"),
                greeks.get("theta"), greeks.get("vega"),
            ))
        token = data.get("next_page_token")
        if not token:
            break
    if rows:
        store.save_chain_snaps(rows)
    return {"underlying": underlying.upper(), "expiry": exp,
            "rows": len(rows), "source": f"alpaca-{feed}"}


def _demo() -> None:
    """Offline self-check: OCC parsing + expiry rollover logic."""
    p = parse_occ("SPY260720C00630000")
    assert p == {"underlying": "SPY", "expiry": "2026-07-20", "right": "C",
                 "strike": 630.0}, p
    assert parse_occ("QQQ260720P00555500")["strike"] == 555.5
    assert parse_occ("not-occ") is None
    tz = _dt.timezone.utc
    # 14:00 ET Tue (18:00 UTC) → same day; 21:00 ET Fri → next Monday
    assert target_expiry(_dt.datetime(2026, 7, 21, 18, 0, tzinfo=tz)) == "2026-07-21"
    assert target_expiry(_dt.datetime(2026, 7, 25, 1, 0, tzinfo=tz)) == "2026-07-27"
    print("chain_recorder._demo OK")


if __name__ == "__main__":
    _demo()
