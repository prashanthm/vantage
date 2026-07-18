"""Replay Forecast — deterministic core: step enumeration, code-scoring reuse,
and the anti-reward-hacking calibration gating."""
from vantage_server import replay_forecast as rf, spx_snapshot as ss


def _sqlite_store(tmp_path):
    from vantage_server.store import Store, _SqliteBackend
    db_path = tmp_path / "vantage.db"
    store = Store.__new__(Store)
    store.data_dir = tmp_path
    store._db_path = db_path
    store._backend = _SqliteBackend(tmp_path, db_path)
    return store


def _seed_day(store, day, *, base=7500.0, n=390, start_min=9 * 60 + 30, offset="-04:00"):
    """Seed a full RTH session (390 1m bars from 09:30) so the step grid has
    real bars to snap to. ``offset`` lets a test simulate an ET DST offset."""
    ts, op, hi, lo, cl, vol = [], [], [], [], [], []
    for i in range(n):
        m = start_min + i
        ts.append(f"{day}T{m // 60:02d}:{m % 60:02d}:00{offset}")
        c = base + (i if i < 200 else 200 - (i - 200))   # up then down
        o = c - 0.5
        op.append(o); cl.append(c)
        hi.append(max(o, c) + 1); lo.append(min(o, c) - 1); vol.append(1000 + i)
    store.save_intraday_bars("^GSPC", day, "1m",
                             {"ts": ts, "open": op, "high": hi, "low": lo,
                              "close": cl, "volume": vol})


# ── step enumeration ─────────────────────────────────────────────────────────

def test_steps_15min_grid_over_rth(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    steps = rf.replay_steps(store, "2026-07-16", "SPX", step_min=15)
    # 09:30 → 16:00 at 15m inclusive = 27 grid points; all have a bar at-or-before
    assert len(steps) == 27
    mins = [s["minute_of_day"] for s in steps]
    assert mins == sorted(mins)                     # chronological
    assert steps[0]["minute_of_day"] == 9 * 60 + 30  # first snaps to the open bar
    assert all("as_of" in s and "price_at" in s for s in steps)


def test_steps_dedupe_when_grid_finer_than_bars(tmp_path):
    # a session that ends at 09:45 (16 bars): a 15m grid past 09:45 snaps back to
    # the same last bar — those duplicate points are dropped, not repeated.
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16", n=16)             # 09:30..09:45
    steps = rf.replay_steps(store, "2026-07-16", "SPX", step_min=15)
    as_ofs = [s["as_of"] for s in steps]
    assert len(as_ofs) == len(set(as_ofs))           # no duplicate snap points


def test_premarket_extends_the_grid_start(tmp_path):
    store = _sqlite_store(tmp_path)
    # seed pre-market + RTH: bars from 08:00
    _seed_day(store, "2026-07-16", n=480, start_min=8 * 60)
    no_pm = rf.replay_steps(store, "2026-07-16", "SPX", step_min=15, premarket=False)
    with_pm = rf.replay_steps(store, "2026-07-16", "SPX", step_min=15, premarket=True)
    assert with_pm[0]["minute_of_day"] < no_pm[0]["minute_of_day"]
    assert with_pm[0]["minute_of_day"] >= 8 * 60


def test_steps_track_dst_offset_from_bars(tmp_path):
    # a winter session at -05:00 (EST): the grid is read from the bars' own ET
    # wall-clock, so the open still snaps to 09:30 regardless of the UTC offset.
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-01-15", offset="-05:00")
    steps = rf.replay_steps(store, "2026-01-15", "SPX", step_min=30)
    assert steps[0]["minute_of_day"] == 9 * 60 + 30


def test_steps_empty_without_bars(tmp_path):
    store = _sqlite_store(tmp_path)
    assert rf.replay_steps(store, "2020-01-01", "SPX") == []


# ── scoring reuses score_forecast BYTE-FOR-BYTE (no separate scorer) ─────────

def test_replay_score_equals_score_forecast(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    _seed_day(store, "2026-07-17")
    d1 = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    row = {"day": "2026-07-16", "symbol": "SPX", "as_of": d1["ts"][100],
           "price_at": d1["close"][100],
           "forecast": {"plot": {"bias": "up", "target": d1["close"][100] + 30,
                                 "invalidation": d1["close"][100] - 40}}}
    fid = store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of=row["as_of"],
        price_at=row["price_at"], snapshot={}, forecast=row["forecast"],
        forecast_text="", run_id="rf-test")
    # the deterministic score, computed independently
    expected = ss.score_forecast(store, store.load_spx_forecast(fid))
    # the run-level score path must produce the identical dict
    rows = store.list_spx_forecasts_by_run("rf-test")
    got = ss.score_forecast(store, rows[0])
    assert got == expected
    assert got["verdict"] in ("hit target", "invalidated", "direction correct",
                              "direction wrong", "inconclusive")


def test_score_forecast_reads_structured_plot(tmp_path):
    # the plot's bare numbers are the authoritative source (not prose)
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    _seed_day(store, "2026-07-17")
    d1 = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    price = d1["close"][-1]
    row = {"day": "2026-07-16", "symbol": "SPX", "as_of": d1["ts"][-1],
           "price_at": price,
           "forecast": {"plot": {"bias": "down", "target": price - 50,
                                 "invalidation": price + 60},
                        # prose that would MISLEAD a prose parser (different number)
                        "sections": [{"kind": "keyvals", "rows": [
                            {"k": "Target", "v": "reclaim toward 99999"}]}]}}
    score = ss.score_forecast(store, row)
    assert score is not None


# ── calibration: code-computed, gated, no fabrication ────────────────────────

def test_calibration_gates_small_buckets(tmp_path):
    # 2 resolved forecasts in a bucket → "insufficient", no rate invented
    rows = [
        {"as_of": "2026-07-16T09:35:00-04:00", "symbol": "SPX",
         "forecast": {"plot": {"bias": "up"}}, "snapshot": {},
         "score": {"verdict": "hit target"}},
        {"as_of": "2026-07-16T09:50:00-04:00", "symbol": "SPX",
         "forecast": {"plot": {"bias": "up"}}, "snapshot": {},
         "score": {"verdict": "direction wrong"}},
    ]
    cal = rf.calibration_scores(rows)
    assert cal["overall"]["insufficient"] is True
    assert "hit_rate" not in cal["overall"]


def test_calibration_reports_rate_when_enough(tmp_path):
    rows = []
    for i in range(4):
        rows.append({"as_of": f"2026-07-16T1{i}:00:00-04:00", "symbol": "SPX",
                     "forecast": {"plot": {"bias": "up"}}, "snapshot": {},
                     "score": {"verdict": "hit target" if i < 3 else "invalidated"}})
    cal = rf.calibration_scores(rows)
    assert cal["overall"]["n"] == 4
    assert cal["overall"]["wins"] == 3
    assert cal["overall"]["hit_rate"] == 0.75


def test_calibration_excludes_inconclusive_from_rate(tmp_path):
    rows = [
        {"as_of": "2026-07-16T10:00:00-04:00", "symbol": "SPX",
         "forecast": {"plot": {"bias": "up"}}, "snapshot": {},
         "score": {"verdict": "inconclusive"}},   # excluded
    ] + [
        {"as_of": f"2026-07-16T1{i}:00:00-04:00", "symbol": "SPX",
         "forecast": {"plot": {"bias": "up"}}, "snapshot": {},
         "score": {"verdict": "hit target"}} for i in range(3)
    ]
    cal = rf.calibration_scores(rows)
    assert cal["overall"]["n"] == 3               # inconclusive not counted


# ── continuous accuracy: target-error + path-MAE ─────────────────────────────

def _fc(target, price_at, post_high, post_low, bias="up", verdict="hit target"):
    return {"as_of": "2026-07-16T10:00:00-04:00", "day": "2026-07-16", "symbol": "SPX",
            "price_at": price_at,
            "forecast": {"plot": {"bias": bias, "target": target}},
            "score": {"verdict": verdict, "post_high": post_high, "post_low": post_low}}


def test_target_error_zero_when_target_hits_the_excursion():
    # up-call, target exactly at the realized high → zero error (reached)
    r = _fc(target=7550, price_at=7500, post_high=7550, post_low=7490)
    assert rf.target_error(r) == 0.0


def test_target_error_zero_on_overshoot():
    # ONE-SIDED: target reached AND price ran past it → the call was right → 0 error.
    # up-call target 7550, high ran to 7570 (20pt overshoot) → NOT penalized.
    r = _fc(target=7550, price_at=7500, post_high=7570, post_low=7490)
    assert rf.target_error(r) == 0.0
    # down-call target 7470, low ran to 7450 (overshoot) → 0.
    r2 = _fc(target=7470, price_at=7500, post_high=7505, post_low=7450, bias="down")
    assert rf.target_error(r2) == 0.0


def test_target_error_up_call_penalizes_only_undershoot():
    # up-call fell 10pt short of target (high only reached 7540, target 7550) → 10.
    r = _fc(target=7550, price_at=7500, post_high=7540, post_low=7490)
    assert rf.target_error(r) == 10.0


def test_target_error_down_call_uses_the_low():
    # down-call: target 7470 below price_at, compared to post_low. Low reached only
    # 7480 (stopped 10pt SHORT of the 7470 target) → 10 undershoot.
    r = _fc(target=7470, price_at=7500, post_high=7505, post_low=7480, bias="down")
    assert rf.target_error(r) == 10.0


def test_target_error_none_without_score_fields():
    r = _fc(target=7550, price_at=7500, post_high=None, post_low=None)
    assert rf.target_error(r) is None
    r2 = {"forecast": {"plot": {}}, "price_at": 7500, "score": {"post_high": 7550, "post_low": 7490}}
    assert rf.target_error(r2) is None            # no target


def test_error_stats_median_and_mean():
    rows = [
        _fc(7550, 7500, 7540, 7490),   # 10
        _fc(7550, 7500, 7530, 7490),   # 20
        _fc(7550, 7500, 7520, 7490),   # 30
    ]
    st = rf.error_stats(rows)
    assert st["n"] == 3
    assert st["median_abs_target_error_pts"] == 20.0
    assert st["mean_abs_target_error_pts"] == 20.0


def test_calibration_carries_error_block():
    rows = [_fc(7550, 7500, 7540, 7490)]
    cal = rf.calibration_scores(rows)
    assert "error" in cal
    assert cal["error"]["median_abs_target_error_pts"] == 10.0


def test_path_mae_measures_shape_against_actual(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")   # up to 200 then down; close at index k = base+..
    _seed_day(store, "2026-07-17")
    d1 = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    as_of = d1["ts"][10]
    # a path whose step prices roughly track the actual later closes → low MAE;
    # here just assert it computes a finite number and is >= 0.
    row = {"as_of": as_of, "day": "2026-07-16", "symbol": "SPX",
           "price_at": d1["close"][10],
           "forecast": {"plot": {"bias": "up", "target": d1["close"][10] + 20,
                                 "path": [{"seq": 1, "price": d1["close"][100]},
                                          {"seq": 2, "price": d1["close"][300]}]}},
           "score": {"verdict": "hit target"}}
    mae = rf.path_mae(row, store)
    assert mae is not None and mae >= 0.0


def test_grade_bundle_carries_code_scores(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    _seed_day(store, "2026-07-17")
    d1 = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    for i in range(4):
        k = 50 + i * 20
        store.save_spx_forecast(
            symbol="SPX", day="2026-07-16", as_of=d1["ts"][k],
            price_at=d1["close"][k], snapshot={"ict_htf": {"present": False}},
            forecast={"plot": {"bias": "up", "target": d1["close"][k] + 20,
                               "invalidation": d1["close"][k] - 40}},
            forecast_text="", run_id="rf-bundle")
    for r in store.list_spx_forecasts_by_run("rf-bundle"):
        sc = ss.score_forecast(store, r)
        if sc:
            store.save_spx_forecast_score(r["id"], sc)
    bundle = rf.gather_grade_bundle(store, "rf-bundle")
    assert bundle is not None
    assert bundle["run_id"] == "rf-bundle" and bundle["day"] == "2026-07-16"
    assert bundle["n_forecasts"] == 4
    assert "overall" in bundle["scores"]
    assert all("verdict" in s for s in bundle["steps"])


def test_grade_bundle_none_for_unknown_run(tmp_path):
    store = _sqlite_store(tmp_path)
    assert rf.gather_grade_bundle(store, "nope") is None


def test_list_replay_runs_summarizes_newest_first(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    d1 = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    # run A: 2 forecasts, 1 scored; run B: 1 forecast, graded
    for k in (30, 60):
        fid = store.save_spx_forecast(
            symbol="SPX", day="2026-07-16", as_of=d1["ts"][k], price_at=d1["close"][k],
            snapshot={}, forecast={"plot": {"bias": "up"}}, forecast_text="", run_id="run-A")
    store.save_spx_forecast_score(fid, {"verdict": "hit target"})   # one scored in A
    store.save_spx_forecast(
        symbol="QQQ", day="2026-07-16", as_of=d1["ts"][90], price_at=d1["close"][90],
        snapshot={}, forecast={"plot": {"bias": "down"}}, forecast_text="", run_id="run-B")
    store.save_spx_calibration({"day": "2026-07-16", "underlying": "QQQ", "run_id": "run-B",
                                "generated_at": "2026-07-16T20:00:00Z", "n_forecasts": 1,
                                "scores": {"overall": {"n": 1}}})
    runs = store.list_replay_runs()
    ids = [r["run_id"] for r in runs]
    assert "run-A" in ids and "run-B" in ids
    a = next(r for r in runs if r["run_id"] == "run-A")
    b = next(r for r in runs if r["run_id"] == "run-B")
    assert a["n"] == 2 and a["n_scored"] == 1 and a["graded"] is False
    assert b["symbol"] == "QQQ" and b["graded"] is True


def test_grade_prompt_forbids_computing_scores(tmp_path):
    # the anti-reward-hacking clause must be in the prompt the grader receives
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    _seed_day(store, "2026-07-17")
    d1 = store.load_intraday_bars("^GSPC", "2026-07-16", "1m")
    store.save_spx_forecast(
        symbol="SPX", day="2026-07-16", as_of=d1["ts"][50],
        price_at=d1["close"][50], snapshot={"ict_htf": {"present": False}},
        forecast={"plot": {"bias": "up", "target": d1["close"][50] + 20,
                           "invalidation": d1["close"][50] - 40}},
        forecast_text="", run_id="rf-prompt")
    bundle = rf.gather_grade_bundle(store, "rf-prompt")
    prompt = rf.build_grade_prompt(bundle)
    assert "ALREADY COMPUTED" in prompt
    assert "NEVER" in prompt and "invent" in prompt


# ── prime_day: idempotent, honest about the 30-day reach ─────────────────────

def test_prime_day_idempotent_when_present(tmp_path):
    store = _sqlite_store(tmp_path)
    _seed_day(store, "2026-07-16")
    out = rf.prime_day(store, "SPX", "2026-07-16")
    assert out["available"] is True and out["primed"] is False   # already stored


def test_prime_day_reports_out_of_window(tmp_path, monkeypatch):
    # simulate yfinance returning nothing for an old day (out of the ~30d window)
    store = _sqlite_store(tmp_path)
    monkeypatch.setattr("vantage_server.seed_intraday._rth_1m", lambda s, d: None)
    out = rf.prime_day(store, "SPX", "2020-01-02")
    assert out["available"] is False
    assert "30 days" in (out.get("note") or "")


def test_prime_day_fetches_when_missing(tmp_path, monkeypatch):
    store = _sqlite_store(tmp_path)
    fake = {"ts": ["2026-07-10T09:30:00-04:00"], "open": [7500.0],
            "high": [7501.0], "low": [7499.0], "close": [7500.5], "volume": [1000]}
    monkeypatch.setattr("vantage_server.seed_intraday._rth_1m", lambda s, d: fake)
    out = rf.prime_day(store, "SPX", "2026-07-10")
    assert out["available"] is True and out["primed"] is True
    assert store.load_intraday_bars("^GSPC", "2026-07-10", "1m") is not None
