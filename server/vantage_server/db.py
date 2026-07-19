"""SQLite backing store — stdlib ``sqlite3`` wrapper for the real-data store.

``Database(path)`` opens a WAL-mode connection with foreign keys on and a
``sqlite3.Row`` factory, applies an idempotent schema, and offers a small
transaction helper. The schema mirrors the JSON shapes the store historically
read from disk (see store.py): ACCUMULATING tables (accounts, lots, history)
get real columns + upsert-by-natural-key so a refresh can INSERT OR REPLACE and
dedupe, while "latest snapshot" tables (bars, strategies, analysis-per-date,
roundtrips, trade_stats, earnings) keep the current code's dict/array payloads
in JSON TEXT columns — minimal reshaping, exact round-trip.

This module is pure persistence: no market-data I/O, no engine logic. Only the
operator-side write methods on Store (and the migration CLI) call the write
paths; the FastAPI/MCP surface only ever reads.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

SCHEMA_VERSION = 23  # v23: strategy_lifecycle + strategy_audit (ADR-015 lifecycle)

#: A ``vantage.db`` in a data-local directory (or an explicit path) selects the
#: SQLite backend. The fixture dataset (server/data) never carries one, so it
#: keeps using the JSON backend and the parity goldens are untouched.
#: Post-v9 paper_trades columns (reclaim discipline), added idempotently.
_PAPER_ADDED_COLUMNS = {
    "spy_opposing": "TEXT",   # JSON: opposing-level book, for retarget-at-fill
    "entry_trigger": "TEXT",
    "entry_note": "TEXT",
    "spy_level": "REAL",
    "fill_status": "TEXT NOT NULL DEFAULT 'filled'",
    "filled_at": "TEXT",
}

DB_FILENAME = "vantage.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    short       TEXT NOT NULL,
    type        TEXT NOT NULL,
    taxable     INTEGER NOT NULL,   -- 0/1 bool
    last_sync   TEXT NOT NULL,
    seq         INTEGER,             -- preserves source ordering
    currency    TEXT NOT NULL DEFAULT 'USD',   -- ISO 4217 denomination
    jurisdiction TEXT NOT NULL DEFAULT 'US'    -- tax jurisdiction (gates US tax)
);

CREATE TABLE IF NOT EXISTS lots (
    account         TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    date            TEXT NOT NULL,
    shares          REAL NOT NULL,
    cost_per_share  REAL NOT NULL,
    seq             INTEGER,
    PRIMARY KEY (account, symbol, date, shares, cost_per_share)
);

CREATE TABLE IF NOT EXISTS recent_buys (
    account TEXT NOT NULL,
    symbol  TEXT NOT NULL,
    date    TEXT NOT NULL,
    note    TEXT NOT NULL,
    seq     INTEGER,
    PRIMARY KEY (account, symbol, date, note)
);

CREATE TABLE IF NOT EXISTS auto_buys (
    account       TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    day_of_month  INTEGER,
    amount        REAL,
    cadence       TEXT,
    seq           INTEGER
);

CREATE TABLE IF NOT EXISTS partner_map (
    symbol      TEXT PRIMARY KEY,
    replacement TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotes (
    symbol      TEXT PRIMARY KEY,
    name        TEXT,
    price       REAL,
    day_pct     REAL,
    asset_class TEXT
);

-- FORECAST-ANALYST forecasts (any ticker): a persisted "what will price do?" read + its later
-- accuracy score against the elapsed price action. Compounds like the journal.
CREATE TABLE IF NOT EXISTS spx_forecast (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol       TEXT NOT NULL,
    day          TEXT NOT NULL,
    as_of        TEXT NOT NULL,   -- the bar time the forecast was made at
    created_at   TEXT,
    price_at     REAL,            -- price when forecast was made
    snapshot     TEXT,            -- JSON: the full snapshot it reasoned over
    forecast     TEXT,            -- JSON: the analyst's structured forecast (bias/path/targets/invalidation)
    forecast_text TEXT,           -- the raw analyst reply (prose fallback)
    scored_at    TEXT,            -- when accuracy was computed (null = unscored)
    score        TEXT,            -- JSON: {hit_target, hit_invalidation, direction_ok, verdict, moved_pt}
    run_id       TEXT             -- groups the forecasts of one Replay Forecast run (null = ad-hoc single forecast)
);
-- NB: the ix_spx_forecast_run index on run_id is created in
-- _add_missing_spx_forecast_columns, AFTER the PRAGMA-guarded ALTER — an old
-- (v19) DB won't have the column when executescript runs, so indexing it here
-- would fail on migration.

-- Per-session INTRADAY (1m) bars, captured when the trade-DNA path fetches them
-- live, so they survive after yfinance's ~30-day intraday retention rolls past.
-- Lets the operator's real FVG entries be tested at 1m resolution later.
CREATE TABLE IF NOT EXISTS intraday_bars (
    symbol       TEXT NOT NULL,
    day          TEXT NOT NULL,   -- ISO date (session)
    interval     TEXT NOT NULL,   -- "1m" | "15m"
    as_of        TEXT,            -- when captured
    bar_count    INTEGER,
    ohlc         TEXT,            -- JSON: {ts:[...], open:[...], high, low, close, volume}
    PRIMARY KEY (symbol, day, interval)
);

CREATE TABLE IF NOT EXISTS bars (
    symbol         TEXT PRIMARY KEY,
    as_of          TEXT,
    lookback_days  INTEGER,
    backfilled     INTEGER,
    first_bar      TEXT,
    last_bar       TEXT,
    bar_count      INTEGER,
    daily          TEXT,   -- JSON array
    weekly         TEXT,   -- JSON array
    monthly        TEXT    -- JSON array
);

CREATE TABLE IF NOT EXISTS history (
    row_key       TEXT PRIMARY KEY,   -- stable content hash (no broker order_id)
    account       TEXT,
    broker_account TEXT,
    date          TEXT,
    kind          TEXT,
    symbol        TEXT,
    description   TEXT,
    side          TEXT,
    quantity      REAL,
    price         REAL,
    amount        REAL,
    state         TEXT,
    extra         TEXT,   -- JSON for any keys outside the known columns
    present_cols  TEXT    -- JSON list of known columns present in the source row
);

CREATE TABLE IF NOT EXISTS strategies (
    id         INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest snapshot
    as_of      TEXT,
    open       TEXT,        -- JSON array
    closed     TEXT,        -- JSON array
    by_ticker  TEXT         -- JSON array
);

CREATE TABLE IF NOT EXISTS analysis (
    date         TEXT PRIMARY KEY,   -- YYYY-MM-DD
    as_of        TEXT,
    generated_at TEXT,
    decisions    TEXT                -- JSON array
);

CREATE TABLE IF NOT EXISTS spx_playbook (
    date      TEXT NOT NULL,      -- generated_for (YYYY-MM-DD)
    symbol    TEXT NOT NULL DEFAULT 'SPX',  -- underlying (SPX | QQQ | IWM)
    session   TEXT,               -- the session the playbook is for
    scaffold  TEXT,               -- JSON: the deterministic playbook scaffold
    narrative TEXT,               -- JSON/text: the LLM narrative (filled lazily; may be null)
    PRIMARY KEY (date, symbol)
);

CREATE TABLE IF NOT EXISTS roundtrips (
    id         INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest snapshot
    as_of      TEXT,
    account    TEXT,
    roundtrips TEXT,     -- JSON array
    summary    TEXT      -- JSON object
);

CREATE TABLE IF NOT EXISTS trade_stats (
    id                 INTEGER PRIMARY KEY CHECK (id = 1),  -- single latest
    as_of              TEXT,
    account            TEXT,
    baseline_win_rate  REAL,
    featured           TEXT,   -- JSON array
    buckets            TEXT,   -- JSON array
    notable            TEXT,   -- JSON array
    by_account         TEXT    -- JSON object
);

CREATE TABLE IF NOT EXISTS earnings (
    symbol   TEXT PRIMARY KEY,
    as_of    TEXT,
    earnings TEXT,   -- JSON array
    dates    TEXT    -- JSON array
);

CREATE TABLE IF NOT EXISTS signals (
    id         INTEGER PRIMARY KEY,
    sym        TEXT NOT NULL,
    pattern    TEXT NOT NULL,
    entry      REAL NOT NULL,
    target     REAL NOT NULL,
    stop       REAL NOT NULL,
    move_pct   REAL,
    conf       REAL,
    time       TEXT,
    seq        INTEGER
);

-- Per-ticker notebook: one structured plan per symbol (thesis / target / stop /
-- free-text notes). Written by the SPA via POST /api/ticker/{sym}/plan — the
-- second deliberate API write after refresh (ADR-014). No broker/fund contact.
CREATE TABLE IF NOT EXISTS ticker_plan (
    symbol      TEXT PRIMARY KEY,
    thesis      TEXT,
    target      REAL,
    stop        REAL,
    notes       TEXT,
    updated_at  TEXT NOT NULL
);

-- Per-ticker running journal: an append-only timeline of auto snapshots (nightly
-- price + P&L + recommendation) interleaved with manual notes. `payload` is JSON.
CREATE TABLE IF NOT EXISTS ticker_journal (
    id          INTEGER PRIMARY KEY,
    symbol      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    kind        TEXT NOT NULL,          -- 'snapshot' | 'note'
    payload     TEXT NOT NULL           -- JSON blob
);
CREATE INDEX IF NOT EXISTS ix_ticker_journal_sym ON ticker_journal(symbol, created_at);

-- Durable level memory: one row per (session, symbol, level). Recorded nightly so
-- a level's history builds over time — the thing that lets us surface a level
-- that has been repeatedly tested/respected across weeks (LuxAlgo-style memory),
-- but built from our own dimensions (fractal S/R, volume PoC, swings, round
-- numbers, and — going forward — GEX walls/flip/max-pain). `dim` is the coarse
-- dimension type (support/resistance/poc/swing/round/gex_wall/gamma_flip/max_pain);
-- `kind` is the human label; `touches` is that session's own touch count (price
-- dimensions only); `day_high`/`day_low`/`day_close` capture where price traded
-- that session so a later pass can ask "did price respect this level?".
CREATE TABLE IF NOT EXISTS level_history (
    session    TEXT NOT NULL,        -- YYYY-MM-DD the level was observed for
    symbol     TEXT NOT NULL,
    price      REAL NOT NULL,
    dim        TEXT NOT NULL,        -- coarse dimension type
    kind       TEXT NOT NULL,        -- human label (e.g. "support (3x tested)")
    source     TEXT NOT NULL,        -- 'chart' | 'GEX' | 'psych'
    touches    INTEGER,              -- session-local touch count (price dims)
    day_high   REAL,
    day_low    REAL,
    day_close  REAL,
    PRIMARY KEY (session, symbol, dim, price)
);
CREATE INDEX IF NOT EXISTS ix_level_history_sym ON level_history(symbol, session);

-- Futures order EXECUTIONS (filled orders) imported from an AMP/CQG CSV export.
-- One row per filled order (AMP "Order ID" is the natural dedupe key). These are
-- the ground truth for round-trip P&L; round-trips + win-rate are DERIVED on read
-- (never stored), because a windowed export can leave positions unpaired and any
-- cached P&L would be wrong. `contract` is normalized (NQ|MNQ); `point_value` is
-- baked at ingest ($20 NQ e-mini / $2 MNQ micro) so dollar P&L is unambiguous.
-- `extra` JSON carries the bracket prices (limit/stop/take-profit/stop-loss).
CREATE TABLE IF NOT EXISTS futures_fills (
    order_id       TEXT PRIMARY KEY,   -- AMP "Order ID" — idempotent dedupe key
    raw_symbol     TEXT NOT NULL,      -- 'F.US.ENQU26'
    contract       TEXT NOT NULL,      -- normalized 'NQ' | 'MNQ'
    contract_month TEXT,               -- 'YYYY-MM' parsed from the CQG month code
    point_value    REAL NOT NULL,      -- 20.0 (NQ) | 2.0 (MNQ)
    side           TEXT NOT NULL,      -- 'Buy' | 'Sell'
    order_type     TEXT,               -- Market | Stop | Stop Loss | Limit
    quantity       REAL,
    fill_quantity  REAL,
    avg_fill_price REAL NOT NULL,
    commission     REAL,               -- usually NULL in the AMP export
    placing_time   TEXT,               -- 'YYYY-MM-DD HH:MM:SS' (ET), as-is
    status_time    TEXT,               -- fill timestamp used for ordering
    status         TEXT,               -- 'Filled'
    duration       TEXT,               -- GTC | DAY
    account        TEXT,               -- logical account tag (default 'ampfutures')
    extra          TEXT,               -- JSON: limit/stop/take_profit/stop_loss
    seq            INTEGER              -- source ordering within an import batch
);
CREATE INDEX IF NOT EXISTS ix_futures_fills_contract ON futures_fills(contract, status_time);

-- Futures ORDER LOG (the fuller history, all statuses) — for order-BEHAVIOR
-- analysis (cancel rate, stop usage), distinct from the executions above. Same
-- Order ID key; Filled rows overlap futures_fills by design (separate concerns).
CREATE TABLE IF NOT EXISTS futures_orders (
    order_id       TEXT PRIMARY KEY,
    raw_symbol     TEXT NOT NULL,
    contract       TEXT NOT NULL,      -- 'NQ' | 'MNQ'
    side           TEXT NOT NULL,
    order_type     TEXT,               -- Market|Stop|Stop Loss|Take Profit|Limit|Trailing Stop
    status         TEXT NOT NULL,      -- 'Filled' | 'Cancelled' | 'Rejected'
    quantity       REAL,
    fill_quantity  REAL,
    avg_fill_price REAL,
    active_at      TEXT,
    placing_time   TEXT,
    status_time    TEXT,
    duration       TEXT,
    account        TEXT,
    extra          TEXT,               -- JSON: limit/stop prices
    seq            INTEGER
);
CREATE INDEX IF NOT EXISTS ix_futures_orders_status ON futures_orders(contract, status);

-- Native dealer-gamma (GEX) snapshot, computed IN Vantage from the yfinance
-- option chain (no longer dependent on Sentinel's file). Single latest snapshot;
-- the full computed dict lives in `snapshot` JSON. `gex_history` accrues one row
-- per session so the playbook's regime→next-day-range edge keeps working.
CREATE TABLE IF NOT EXISTS gex_snapshot (
    symbol    TEXT PRIMARY KEY,                    -- one latest snapshot per underlying
    date      TEXT,                                -- YYYY-MM-DD (ET)
    snapshot  TEXT                                 -- JSON: full compute_gex dict
);

CREATE TABLE IF NOT EXISTS gex_history (
    date            TEXT NOT NULL,      -- session (ET date)
    symbol          TEXT NOT NULL,      -- underlying
    spot            REAL,
    net_gex_bn      REAL,
    regime          TEXT,
    gamma_flip      REAL,
    call_wall       REAL,
    put_wall        REAL,
    max_pain        REAL,
    call_share_pct  REAL,
    PRIMARY KEY (date, symbol)
);

-- Paper trades: a NO-MONEY track record of the 0DTE playbook's signals traded on
-- SPY (the SPX proxy). Each row is one simulated trade — opened at a signal's SPY
-- entry with a target (the next playbook level) and stop (just beyond the signal
-- level), then auto-closed by checking SPY intraday bars for the first touch of
-- target or stop. P&L is on SPY SHARES (the honest, simple proxy); `ref_strike`
-- records the nearest 0DTE option strike for reference only. This is a simulation
-- for learning + strategy validation — it places NO real orders (ADR-010).
CREATE TABLE IF NOT EXISTS paper_trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    opened_at    TEXT NOT NULL,      -- ISO timestamp the paper trade was logged
    session      TEXT,               -- playbook session date it came from
    signal       TEXT NOT NULL,      -- human label ('fade resistance 754.95', ...)
    side         TEXT NOT NULL,      -- 'long' (buy dip) | 'short' (fade rally)
    symbol       TEXT NOT NULL,      -- 'SPY'
    spx_level    REAL,               -- the SPX level the signal keyed off
    spy_entry    REAL NOT NULL,      -- SPY price at open
    spy_target   REAL,               -- next playbook level (SPY terms)
    spy_stop     REAL,               -- just beyond the signal level (SPY terms)
    shares       REAL,               -- notional share count for the P&L calc
    ref_strike   REAL,               -- nearest 0DTE strike (reference only)
    source       TEXT,               -- 'auto' (signal) | 'manual'
    status       TEXT NOT NULL,      -- 'open' | 'closed'
    opened_price_src TEXT,           -- where the entry price came from
    closed_at    TEXT,               -- ISO close time
    spy_exit     REAL,               -- SPY price at close
    exit_reason  TEXT,               -- 'target' | 'stop' | 'manual' | 'expired' | 'never_filled'
    pnl          REAL,               -- (exit-entry)*shares signed by side
    pnl_pct      REAL,               -- % move on SPY
    entry_trigger TEXT,              -- 'reclaim-3x5m' | NULL (immediate fill)
    entry_note   TEXT,               -- the ticket's entry discipline, verbatim
    spy_level    REAL,               -- the signal level in proxy terms (reclaim gate)
    fill_status  TEXT NOT NULL DEFAULT 'filled',  -- 'pending' | 'filled'
    filled_at    TEXT                -- ISO time the reclaim fill happened
);
CREATE INDEX IF NOT EXISTS ix_paper_status ON paper_trades(status, opened_at);

-- Chart-snapshot journal: a saved chart IMAGE paired with the playbook forecast
-- that was live when it was captured, so we can look back and score what was
-- FORECAST vs what actually HAPPENED — building (or dissolving) confidence in the
-- projections with evidence. The image bytes live on disk (data-dir/journal/);
-- this row holds the metadata + a frozen copy of the forecast (`forecast` JSON:
-- session, spot, regime, the plan line, and the key levels with roles) and a
-- later-computed `scorecard` JSON (which levels held/broke, was the regime call
-- right, price range since). Context/journal only — no orders (ADR-010).
CREATE TABLE IF NOT EXISTS journal_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at   TEXT NOT NULL,      -- ISO timestamp captured
    session      TEXT,               -- the playbook session it was linked to
    symbol       TEXT,               -- 'SPX' (proxy price scored on SPX/SPY)
    image_path   TEXT,               -- relative path under the journal dir
    image_mime   TEXT,               -- e.g. image/png
    note         TEXT,               -- the user's short note
    spot_at_snap REAL,               -- price when captured (for the outcome delta)
    forecast     TEXT,               -- JSON: frozen forecast (levels/regime/plan)
    scorecard    TEXT,               -- JSON: forecast-vs-outcome (filled later)
    scored_at    TEXT,               -- when the scorecard was last computed
    forecast_kind TEXT,              -- 'prior' | 'live': which forecast was frozen
    entry        TEXT,               -- JSON: structured trade-action log (what I did)
    entry_updated_at TEXT            -- when the entry was last edited
);
CREATE INDEX IF NOT EXISTS ix_journal_created ON journal_snapshots(created_at);

-- Managed-exit positions (ADR-010 v3): one row per REAL position opened via
-- the reclaim-ticket execution carve-out, owned by execution_monitor. The
-- monitor may only ever REDUCE these positions (place the protective stop,
-- swap stop→target sell, ratchet a trailing stop, cancel its own orders) —
-- never open exposure, never exceed qty, never touch a symbol without a row
-- here. A broker-resident stop (stop_order_id) is the invariant while active.
CREATE TABLE IF NOT EXISTS managed_positions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    opened_at      TEXT NOT NULL,      -- ISO timestamp the entry was placed
    account_number TEXT NOT NULL,      -- broker account the orders live in
    symbol         TEXT NOT NULL,      -- e.g. 'SPY' (already proxy-resolved)
    side           TEXT NOT NULL,      -- 'long' | 'short'
    qty            REAL NOT NULL,      -- managed share count (hard ceiling)
    entry_order_id TEXT,               -- broker id of the entry order
    entry_price    REAL,               -- avg fill (set when filled)
    initial_stop   REAL NOT NULL,      -- ticket stop; trail distance anchor
    stop_price     REAL,               -- current resting stop level
    stop_order_id  TEXT,               -- broker id of the resting stop
    exit_policy    TEXT NOT NULL,      -- 'ladder' | 'trailing'
    target_price   REAL,               -- T1 (ladder policy; NULL = open-ended)
    high_water     REAL,               -- best price since fill (trailing anchor)
    status         TEXT NOT NULL,      -- 'pending_entry'|'active'|'closed'|'disarmed'
    last_checked   TEXT,               -- monitor heartbeat (ISO)
    closed_at      TEXT,
    exit_reason    TEXT,               -- 'stop'|'trail'|'target'|'never_filled'|'disarmed'|'adopted_flat'
    exit_price     REAL,
    note           TEXT,               -- free-form breadcrumbs (ticket source, warnings)
    signal_paper_id INTEGER            -- the reclaim signal (paper_trades.id) this
                                       -- execution was taken from, when known —
                                       -- the signal↔live performance join key
);
CREATE INDEX IF NOT EXISTS ix_managed_status ON managed_positions(status, opened_at);

-- Nightly pipeline snapshots: one row per nightly-docker.sh run, with the
-- per-job results the bash `run()` helper collected ({job, ok, duration_sec,
-- tail} JSON). Read by GET /api/nightly/status, the 🌙 telegram digest, and
-- the Signal Bot view — so "did last night actually work, job by job" is a
-- glance, not a log dig.
CREATE TABLE IF NOT EXISTS nightly_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,      -- ISO, host clock
    finished_at TEXT,
    variant     TEXT,               -- 'docker' | 'host'
    jobs        TEXT NOT NULL       -- JSON array [{job, ok, duration_sec, tail}]
);
CREATE INDEX IF NOT EXISTS ix_nightly_started ON nightly_runs(started_at);

-- Persisted trade analysis: the DNA snapshot (price action / volume /
-- technicals / level correlation frozen at analysis time) AND Mira's read of
-- it, keyed by the trade's identity. Frozen so the record survives even after
-- 1-minute bars age out of yfinance (~30 days) — the DNA a swing/0DTE was
-- judged on is preserved verbatim, not recomputed. One row per (day, trade
-- key); re-analyzing overwrites it.
CREATE TABLE IF NOT EXISTS trade_analysis (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    day         TEXT NOT NULL,       -- session date (YYYY-MM-DD)
    trade_key   TEXT NOT NULL,       -- the trade's stable identity (opened_at|label)
    underlying  TEXT NOT NULL,
    label       TEXT,                -- human label, for listing
    analyzed_at TEXT NOT NULL,       -- when the read was produced
    dna         TEXT NOT NULL,       -- JSON: the frozen DNA snapshot
    analysis    TEXT,                -- Mira's prose read (may be null if unsaved)
    UNIQUE (day, trade_key)
);
CREATE INDEX IF NOT EXISTS ix_trade_analysis_day ON trade_analysis(day, underlying);

-- Journal Analysis (v17): the compounding, periodic self-assessment. Each row
-- is one run over a date window, TAGGED daily|weekly|monthly, scored against a
-- versioned rubric, carrying the SWOT + patterns + recommendations. The next
-- run reads the prior one (prior_id) so knowledge compounds, and tracks
-- whether earlier recommendations moved the scores. One row per
-- (period, window_from, window_to, underlying); re-running overwrites.
CREATE TABLE IF NOT EXISTS journal_analysis (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    period         TEXT NOT NULL,       -- 'daily' | 'weekly' | 'monthly'
    window_from    TEXT NOT NULL,       -- YYYY-MM-DD (inclusive)
    window_to      TEXT NOT NULL,       -- YYYY-MM-DD (inclusive)
    underlying     TEXT NOT NULL,
    generated_at   TEXT NOT NULL,
    rubric_version INTEGER NOT NULL,    -- which scoring rubric produced `scores`
    prior_id       INTEGER,             -- the analysis this one built on (compounding)
    trades         INTEGER,             -- n trades in the window
    net_pnl        REAL,                -- realized net over the window
    scores         TEXT,                -- JSON {dimension: 0-100, ...}
    swot           TEXT,                -- JSON {strengths, weaknesses, opportunities, threats}
    patterns       TEXT,                -- JSON [{pattern, count, cites[]}]
    recommendations TEXT,               -- JSON [{text, status, evidence}]
    narrative      TEXT,                -- the model's prose synthesis
    UNIQUE (period, window_from, window_to, underlying)
);
CREATE INDEX IF NOT EXISTS ix_journal_analysis_win ON journal_analysis(window_to, period, underlying);

-- Replay-Forecast CALIBRATION (v20): the grader-owned, read-only memory. One row
-- per graded replay run — the DETERMINISTIC hit-rate (overall + bucketed by
-- time-of-day / bias / tier), computed in Python (`scores`), plus the grader's
-- prose read (`patterns`, `narrative`). This is the accountability record; it is
-- NEVER fed back to the forecasting analyst (that would be reward-hacking). The
-- next grade reads the prior one (prior_id) so calibration compounds. One row per
-- (day, underlying, run_id); re-grading a run overwrites.
CREATE TABLE IF NOT EXISTS spx_calibration (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    day            TEXT NOT NULL,       -- session the run replayed (YYYY-MM-DD)
    underlying     TEXT NOT NULL,
    run_id         TEXT NOT NULL,       -- the replay run this calibrates
    generated_at   TEXT NOT NULL,
    prior_id       INTEGER,             -- the calibration this one built on (compounding)
    n_forecasts    INTEGER,             -- scored forecasts in the run
    scores         TEXT,                -- JSON: code-computed hit-rates {overall, by_time, by_bias, by_tier}
    patterns       TEXT,                -- JSON [{pattern, cites[]}] — grader prose, no numbers invented
    narrative      TEXT,                -- the grader's prose synthesis
    UNIQUE (day, underlying, run_id)
);
CREATE INDEX IF NOT EXISTS ix_spx_calibration_gen ON spx_calibration(generated_at, underlying);

-- ICT SCANNER (v21). Two single-purpose tables:
-- `scanner_universe` — the resolved ticker universe (top-10 holdings of SPY/QQQ/IWM,
-- deduped), cached so a scan doesn't refetch holdings every run. One row per set key
-- (default 'default'); `symbols` is a JSON list, `fetched_at` marks freshness.
CREATE TABLE IF NOT EXISTS scanner_universe (
    set_key    TEXT PRIMARY KEY,          -- 'default' (future: named universes)
    symbols    TEXT NOT NULL,             -- JSON list of tickers
    source     TEXT,                      -- 'holdings' | 'pinned-fallback'
    fetched_at TEXT NOT NULL
);

-- `scanner_result` — the LATEST scan snapshot per scanner type. `result` is the full
-- JSON the UI + cron read ({hits[], no_data[], universe_n, covered_n, ...}); one row
-- per scanner so a refresh overwrites. Deterministic, no LLM, no orders (ADR-010).
CREATE TABLE IF NOT EXISTS scanner_result (
    scanner    TEXT PRIMARY KEY,          -- 'ict_htf' (pluggable: more later)
    ran_at     TEXT NOT NULL,
    result     TEXT NOT NULL              -- JSON: full scan result
);

-- CHART DRAWINGS (v22). User-drawn annotations on the chart-first InstrumentChart,
-- persisted per symbol so they survive reload and become context Mira can read
-- ("the operator drew support at 7460"). One row per drawing; `kind` is the tool
-- (hline|trendline|ray|rect); `points` is JSON [{time,price}...] (1 pt for hline,
-- 2 for the rest); `style` is JSON (color/width). Deterministic, no LLM, no orders.
CREATE TABLE IF NOT EXISTS chart_drawings (
    id          TEXT PRIMARY KEY,         -- client-generated uuid (idempotent upsert)
    symbol      TEXT NOT NULL,
    kind        TEXT NOT NULL,            -- 'hline' | 'trendline' | 'ray' | 'rect'
    points      TEXT NOT NULL,            -- JSON [{time,price}, ...]
    style       TEXT,                     -- JSON {color, width, label?}
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_chart_drawings_sym ON chart_drawings(symbol, created_at);

-- ADR-015 strategy lifecycle: one row per registered strategy, its stage +
-- caps + which live account it was promoted to. Stage machine:
-- paper -> eligible -> live -> paused.
CREATE TABLE IF NOT EXISTS strategy_lifecycle (
    strategy_id   TEXT PRIMARY KEY,      -- registry id, e.g. 'reclaim'
    stage         TEXT NOT NULL,         -- paper | eligible | live | paused
    caps          TEXT,                  -- JSON {max_order_usd, max_positions, max_daily_loss_usd}
    live_account  TEXT,                  -- broker account promoted to (null until live)
    baseline_win_rate REAL,              -- frozen backtest baseline at last gate check
    paper_win_rate    REAL,              -- last measured live-paper win-rate
    paper_n           INTEGER,           -- sample size behind paper_win_rate
    promoted_at   TEXT,                  -- ISO ts of the operator promote (null until live)
    paused_reason TEXT,                  -- why paused (cap/kill/operator), null when active
    updated_at    TEXT NOT NULL
);

-- ADR-015 gate 4: append-only audit of EVERY autonomous order decision. Never
-- updated or deleted — the immutable record of what the bot did and why.
CREATE TABLE IF NOT EXISTS strategy_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          TEXT NOT NULL,           -- ISO timestamp
    strategy_id TEXT NOT NULL,
    mode        TEXT NOT NULL,           -- submitted | dry_run | refused | cap_breach
    reason      TEXT,                    -- human reason (refusal/dry-run cause)
    order_json  TEXT NOT NULL,           -- the recomputed order
    gates_json  TEXT,                    -- gate state at decision time
    order_id    TEXT                     -- broker order id when submitted
);
CREATE INDEX IF NOT EXISTS ix_strategy_audit_strat ON strategy_audit(strategy_id, at);
"""

#: Post-v12 managed_positions columns, added idempotently (same PRAGMA-guard
#: pattern as the journal/paper columns).
_MANAGED_ADDED_COLUMNS = {
    "signal_paper_id": "INTEGER",
}

#: columns added after v7 to the (pre-existing) journal_snapshots table. Applied
#: idempotently by ``init_schema`` via ALTER TABLE — SQLite has no
#: ``ADD COLUMN IF NOT EXISTS``, so we guard on PRAGMA table_info.
_JOURNAL_ADDED_COLUMNS = {
    "forecast_kind": "TEXT",
    "entry": "TEXT",
    "entry_updated_at": "TEXT",
}

#: v19->v20: additively add the replay run-grouping column to a DB that already
#: has the v19 spx_forecast table (executescript skips existing tables).
_SPX_FORECAST_ADDED_COLUMNS = {
    "run_id": "TEXT",
}


class Database:
    """A thin, idempotent wrapper over a single SQLite file."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    # ----------------------------------------------------------- connection

    def connect(self) -> sqlite3.Connection:
        """Open a connection with WAL, foreign keys, and Row rows. Callers own
        the connection lifetime (close it, or use ``transaction``)."""
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init_schema(self, conn: sqlite3.Connection | None = None) -> None:
        """Create every table if absent and stamp the schema version. Safe to
        call repeatedly (CREATE TABLE IF NOT EXISTS)."""
        own = conn is None
        conn = conn or self.connect()
        try:
            conn.executescript(_SCHEMA)
            self._add_missing_journal_columns(conn)
            self._add_missing_spx_forecast_columns(conn)
            self._add_missing_paper_columns(conn)
            self._add_missing_managed_columns(conn)
            self._add_missing_account_columns(conn)
            self._migrate_multi_underlying(conn)
            conn.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?)\n"
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(SCHEMA_VERSION),),
            )
            conn.commit()
        finally:
            if own:
                conn.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """A committed-on-success / rolled-back-on-error connection scope."""
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @staticmethod
    def _add_missing_journal_columns(conn: sqlite3.Connection) -> None:
        """Additively add post-v7 journal_snapshots columns to a DB that already
        has the older table (the executescript above skips existing tables).
        Idempotent: guarded on the current column set. Preserves all rows."""
        have = {r["name"] for r in conn.execute(
            "PRAGMA table_info(journal_snapshots)").fetchall()}
        for col, decl in _JOURNAL_ADDED_COLUMNS.items():
            if col not in have:
                conn.execute(
                    f"ALTER TABLE journal_snapshots ADD COLUMN {col} {decl}")

    @staticmethod
    def _add_missing_spx_forecast_columns(conn: sqlite3.Connection) -> None:
        """v19->v20: additively add the replay ``run_id`` grouping column.
        Idempotent; existing single-forecast rows keep run_id NULL (ad-hoc)."""
        have = {r["name"] for r in conn.execute(
            "PRAGMA table_info(spx_forecast)").fetchall()}
        for col, decl in _SPX_FORECAST_ADDED_COLUMNS.items():
            if col not in have:
                conn.execute(f"ALTER TABLE spx_forecast ADD COLUMN {col} {decl}")
        # index run_id only now that the column is guaranteed to exist
        conn.execute("CREATE INDEX IF NOT EXISTS ix_spx_forecast_run "
                     "ON spx_forecast(run_id, as_of)")

    @staticmethod
    def _add_missing_account_columns(conn: sqlite3.Connection) -> None:
        """v10->v11: additively add currency/jurisdiction; existing rows default
        to USD/US (unchanged behavior)."""
        have = {r["name"] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
        if "currency" not in have:
            conn.execute("ALTER TABLE accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'")
        if "jurisdiction" not in have:
            conn.execute("ALTER TABLE accounts ADD COLUMN jurisdiction TEXT NOT NULL DEFAULT 'US'")

    @staticmethod
    def _add_missing_paper_columns(conn: sqlite3.Connection) -> None:
        """v9->v10: additively add the paper reclaim-discipline columns.
        Idempotent; existing rows default to fill_status='filled' (they were
        opened under the immediate-fill regime)."""
        have = {r["name"] for r in conn.execute(
            "PRAGMA table_info(paper_trades)").fetchall()}
        for col, decl in _PAPER_ADDED_COLUMNS.items():
            if col not in have:
                conn.execute(f"ALTER TABLE paper_trades ADD COLUMN {col} {decl}")

    @staticmethod
    def _add_missing_managed_columns(conn: sqlite3.Connection) -> None:
        """v12->v13: additively add the signal↔live link column."""
        have = {r["name"] for r in conn.execute(
            "PRAGMA table_info(managed_positions)").fetchall()}
        for col, decl in _MANAGED_ADDED_COLUMNS.items():
            if col not in have:
                conn.execute(f"ALTER TABLE managed_positions ADD COLUMN {col} {decl}")

    @staticmethod
    def _migrate_multi_underlying(conn: sqlite3.Connection) -> None:
        """v8→v9: re-key gex_snapshot / gex_history / spx_playbook to include
        ``symbol`` in their primary key, so SPX/QQQ/IWM coexist. ``CREATE TABLE IF
        NOT EXISTS`` skips existing tables, so rebuild any that still carry the old
        single-underlying PK. Idempotent (guarded on the live PK); preserves rows,
        stamping legacy rows with their stored symbol (default 'SPX'/'^SPX')."""
        def _pk_cols(table: str) -> list[str]:
            rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
            return [r["name"] for r in rows if r["pk"]]

        # gex_snapshot: old PK = [id]; new PK = [symbol]
        if _pk_cols("gex_snapshot") == ["id"]:
            conn.executescript("""
                ALTER TABLE gex_snapshot RENAME TO gex_snapshot_old;
                CREATE TABLE gex_snapshot (
                    symbol TEXT PRIMARY KEY, date TEXT, snapshot TEXT);
                INSERT OR REPLACE INTO gex_snapshot(symbol, date, snapshot)
                    SELECT COALESCE(symbol, '^SPX'), date, snapshot FROM gex_snapshot_old;
                DROP TABLE gex_snapshot_old;
            """)

        # gex_history: old PK = [date]; new PK = [date, symbol]
        if _pk_cols("gex_history") == ["date"]:
            conn.executescript("""
                ALTER TABLE gex_history RENAME TO gex_history_old;
                CREATE TABLE gex_history (
                    date TEXT NOT NULL, symbol TEXT NOT NULL, spot REAL,
                    net_gex_bn REAL, regime TEXT, gamma_flip REAL, call_wall REAL,
                    put_wall REAL, max_pain REAL, call_share_pct REAL,
                    PRIMARY KEY (date, symbol));
                INSERT OR REPLACE INTO gex_history
                    SELECT date, COALESCE(symbol, '^SPX'), spot, net_gex_bn, regime,
                           gamma_flip, call_wall, put_wall, max_pain, call_share_pct
                    FROM gex_history_old;
                DROP TABLE gex_history_old;
            """)

        # spx_playbook: old PK = [date]; new PK = [date, symbol]
        if _pk_cols("spx_playbook") == ["date"]:
            conn.executescript("""
                ALTER TABLE spx_playbook RENAME TO spx_playbook_old;
                CREATE TABLE spx_playbook (
                    date TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT 'SPX',
                    session TEXT, scaffold TEXT, narrative TEXT,
                    PRIMARY KEY (date, symbol));
                INSERT OR REPLACE INTO spx_playbook(date, symbol, session, scaffold, narrative)
                    SELECT date, 'SPX', session, scaffold, narrative FROM spx_playbook_old;
                DROP TABLE spx_playbook_old;
            """)

    def schema_version(self) -> int | None:
        conn = self.connect()
        try:
            row = conn.execute(
                "SELECT value FROM meta WHERE key='schema_version'"
            ).fetchone()
            return int(row["value"]) if row else None
        except sqlite3.OperationalError:
            return None  # meta table not created yet
        finally:
            conn.close()


# ---------------------------------------------------------------- JSON helpers


def dumps(value: Any) -> str:
    """Compact-but-stable JSON for a TEXT column."""
    return json.dumps(value, ensure_ascii=False)


def loads(text: Any, default: Any = None) -> Any:
    """Parse a JSON TEXT column, tolerating NULL/empty by returning ``default``."""
    if text is None or text == "":
        return default
    if not isinstance(text, (str, bytes, bytearray)):
        return text
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return default


def history_row_key(row: dict) -> str:
    """A stable natural key for a history row.

    Broker history rows carry no ``order_id``, so we hash the identifying
    content (account + full transaction tuple) to a deterministic key. Two rows
    describing the same transaction collapse to the same key — the dedupe the
    accumulate contract needs — while genuinely distinct rows stay distinct.
    An explicit ``order_id`` is honored when present (future-proofing)."""
    import hashlib

    if row.get("order_id"):
        return f"oid:{row['order_id']}"
    ident = [
        str(row.get("account") or ""),
        str(row.get("broker_account") or ""),
        str(row.get("date") or ""),
        str(row.get("kind") or ""),
        str(row.get("symbol") or ""),
        str(row.get("description") or ""),
        str(row.get("side") or ""),
        repr(row.get("quantity")),
        repr(row.get("price")),
        repr(row.get("amount")),
        str(row.get("state") or ""),
    ]
    digest = hashlib.sha1("\x1f".join(ident).encode("utf-8")).hexdigest()
    return f"h:{digest}"


#: The history columns stored as first-class columns; everything else on a row
#: is preserved in the ``extra`` JSON column so a round-trip is lossless.
HISTORY_COLUMNS = (
    "account", "broker_account", "date", "kind", "symbol", "description",
    "side", "quantity", "price", "amount", "state",
)
