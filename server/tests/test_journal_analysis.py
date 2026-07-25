

def test_leak_census_flags_a_real_leak_and_mutes_noise():
    """A condition whose credible interval clearly separates from baseline is a
    'leak'; same-rate buckets stay verdict=None (noise never reads as signal)."""
    from vantage_server.journal_analysis import leak_census
    trades = []
    # 12 morning winners, 12 late losers → 'entry late' must flag as leak
    for i in range(12):
        trades.append({"realized": 120, "cost": (400 if i % 2 else 600), "opened_et": "09:45",
                       "opened_at": f"2026-07-01T13:{i:02d}:00Z",
                       "closed_at": f"2026-07-01T14:{i:02d}:00Z"})
    for i in range(12):
        trades.append({"realized": -100, "cost": (400 if i % 2 else 600), "opened_et": "14:30",
                       "opened_at": f"2026-07-01T18:{i:02d}:00Z",
                       "closed_at": f"2026-07-01T19:{i:02d}:00Z"})
    c = leak_census(trades)
    by = {b["name"]: b for b in c["buckets"]}
    assert by["entry late (14:00+)"]["verdict"] == "leak"
    assert by["entry at open (9:30-10:30)"]["verdict"] == "edge"
    assert by["size at/above window median"]["verdict"] is None  # no separation


def test_forecast_calibration_buckets(tmp_path):
    """Scored live forecasts bucket by gamma x hour; replay rows and
    inconclusive verdicts are excluded; small buckets carry n only."""
    from vantage_server.forecast_calibration import calibration
    from vantage_server.store import Store, _SqliteBackend
    s = Store(str(tmp_path))
    s._backend = _SqliteBackend(tmp_path, tmp_path / "vantage.db")
    import json as _json
    conn = s._backend._conn()
    rows = []
    for i in range(10):   # 10 negative-gamma late calls: 7 hits, 3 invalidated
        rows.append(("SPX", "2026-07-21", f"2026-07-21T14:{30+i//4:02d}:00-04:00",
                     _json.dumps({"regime": {"gamma": "negative"}}),
                     _json.dumps({"verdict": "hit target" if i < 7 else "invalidated"}), None))
    rows.append(("SPX", "2026-07-21", "2026-07-21T09:45:00-04:00",
                 _json.dumps({"regime": {"gamma": "positive"}}),
                 _json.dumps({"verdict": "hit target"}), None))           # small bucket
    rows.append(("SPX", "2026-07-21", "2026-07-21T14:45:00-04:00",
                 _json.dumps({"regime": {"gamma": "negative"}}),
                 _json.dumps({"verdict": "hit target"}), "exp-run"))      # replay: excluded
    for sym, day, as_of, snap, score, run in rows:
        conn.execute("INSERT INTO spx_forecast(symbol,day,as_of,created_at,snapshot,score,run_id) "
                     "VALUES(?,?,?,?,?,?,?)", (sym, day, as_of, as_of, snap, score, run))
    conn.commit(); conn.close()
    c = calibration(s)
    assert c["overall"]["n"] == 11                       # replay row excluded
    late = next(x for x in c["conditions"] if x["hour"] == "late")
    assert late["n"] == 10 and late["hit_rate"] == 0.7
    small = next(x for x in c["conditions"] if x["hour"] == "open")
    assert small["n"] == 1 and "hit_rate" not in small   # below min_n
