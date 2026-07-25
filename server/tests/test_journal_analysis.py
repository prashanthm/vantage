

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
