// Phase V4 — live integration adapter (ADR-013/ADR-014).
//
// Talks to the Vantage backend (REST, :8641) and Mira (AI, :8080) with plain
// fetch + ReadableStream — no dependencies, no EventSource. Every function is
// progressive-enhancement-safe: it returns null (never throws) on any failure,
// so the SPA's fixture data remains the default experience when either service
// is down. Mappers convert API payloads (snake_case, enveloped) into the exact
// shapes the views already consume from src/util.jsx / src/data.js.
import { loadSettings } from "./util.jsx";

/* ---------------- low-level fetch ---------------- */

// GET url -> parsed JSON, or null on non-200 / network error / timeout.
export async function getJson(url, { timeoutMs = 2500 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null; // unreachable, aborted, or bad JSON — callers fall back to fixtures
  } finally {
    clearTimeout(timer);
  }
}

// POST url + JSON body -> parsed JSON, or null on non-200 / network error /
// timeout. Refresh is a slower operation (a real broker round-trip), so its
// timeout is longer than a GET. Never throws — a backend that is down resolves
// to null and the caller surfaces a quiet note.
export async function postJson(url, body = {}, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null; // unreachable, aborted, or bad JSON — caller shows a note
  } finally {
    clearTimeout(timer);
  }
}

const backendBase = () => (loadSettings().backendUrl || "").replace(/\/+$/, "");
const miraBase = () => (loadSettings().miraUrl || "").replace(/\/+$/, "");

/* ---------------- Vantage backend client (:8641) ---------------- */

export const health = () => getJson(`${backendBase()}/api/health`);
// GET /api/accounts -> {accounts: [{id, short, type, value, last_synced, ...}]}
// or null. Each account now carries last_synced (from the store's meta) so the
// rail can show "synced 5m ago".
export const accounts = () => getJson(`${backendBase()}/api/accounts`, { timeoutMs: 30000 });

// POST /api/refresh — THE deliberate write. Re-pull one account's (or, with no
// account, every API-broker account's) holdings + transactions into the store.
// Read broker tools only; the backend can never place an order. Resolves to
// null when the backend is down (caller shows a quiet note), or a payload
// {results: [{account, positions, new_transactions, cash, csv_only?, errors}]}.
// Account management (settings-page write surface). Secrets are NEVER sent —
// the backend only stores account metadata (name/currency/jurisdiction/broker)
// and reports auth status + the host-side command to grant it.
export const createAccount = (body) => postJson(`${backendBase()}/api/accounts`, body);
export const editAccount = (id, body) => postJson(`${backendBase()}/api/accounts/${encodeURIComponent(id)}/edit`, body);
export const deleteAccount = (id) => postJson(`${backendBase()}/api/accounts/${encodeURIComponent(id)}/delete`, {});
export const syncAccount = (id) => postJson(`${backendBase()}/api/accounts/${encodeURIComponent(id)}/sync`, {});
// Upload a broker transaction-history CSV → parsed buys/sells into our history
// table (realized_gains FIFO-matches them). Multipart; returns {imported, buys,
// sells, warnings} or {available:false}.
// Shared multipart CSV upload to an /api/import/* endpoint (positions or
// transactions). Returns the JSON envelope, or {available:false, note}.
async function importCsv(kind, file, account, broker) {
  const base = backendBase();
  if (!base) return { available: false };
  const fd = new FormData();
  fd.append("file", file, file.name || `${kind}.csv`);
  fd.append("account", account);
  fd.append("broker", broker || "fidelity");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${base}/api/import/${kind}`, {
      method: "POST", body: fd, signal: ctrl.signal,
    });
    return res.ok ? await res.json() : { available: false, note: `HTTP ${res.status}` };
  } catch (e) {
    return { available: false, note: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}
// Transaction history (buys/sells → realized gains). See importCsv.
export const importTransactions = (file, account, broker = "fidelity") =>
  importCsv("transactions", file, account, broker);
// Positions (holdings snapshot → drives the whole portfolio analysis).
export const importPositions = (file, account, broker = "fidelity") =>
  importCsv("positions", file, account, broker);
// Kite one-click re-auth: fetch the login URL to open (the backend catches the
// redirect and saves the daily token; no copy-paste). Returns {login_url} or
// {error}.
export const kiteLoginUrl = () => getJson(`${backendBase()}/api/kite/login-url`);

export const refreshAccount = (accountId) =>
  postJson(`${backendBase()}/api/refresh`, { account: accountId });
export const refreshAll = () => postJson(`${backendBase()}/api/refresh`, {});
export const positions = (account = "all") =>
  getJson(`${backendBase()}/api/positions?account=${encodeURIComponent(account)}`);
export const allocation = (account = "all") =>
  getJson(`${backendBase()}/api/allocation?account=${encodeURIComponent(account)}`);
// Portfolio Analyzer roll-up: diversification + income + character + risk +
// winners/losers + per-account, all currency-scoped. `currency` filters the
// currency-scoped cards to one bucket (omit → the dominant bucket).
export const portfolioAnalyze = (account = "all", currency = "") =>
  getJson(`${backendBase()}/api/portfolio/analyze?account=${encodeURIComponent(account)}` +
    (currency ? `&currency=${encodeURIComponent(currency)}` : ""), { timeoutMs: 60000 });
export const portfolioPerformance = (account = "all") =>
  getJson(`${backendBase()}/api/portfolio/performance?account=${encodeURIComponent(account)}`);
export const lots = (account = "all") =>
  getJson(`${backendBase()}/api/lots?account=${encodeURIComponent(account)}`);
export const wash = () => getJson(`${backendBase()}/api/tax/wash`);
// Realized capital gains (FIFO lot-matched equity history): ST/LT split + est. tax.
export const taxGains = (account = "all", year) => {
  const q = new URLSearchParams({ account });
  if (year) q.set("year", year);
  return getJson(`${backendBase()}/api/tax/gains?${q}`, { timeoutMs: 20000 });
};
export const tlh = ({ thresholdUsd, thresholdPct } = {}) => {
  const q = new URLSearchParams();
  if (thresholdUsd != null) q.set("thresholdUsd", String(thresholdUsd));
  if (thresholdPct != null) q.set("thresholdPct", String(thresholdPct));
  const qs = q.toString();
  return getJson(`${backendBase()}/api/tax/tlh${qs ? `?${qs}` : ""}`);
};
export const quotes = () => getJson(`${backendBase()}/api/quotes`);
export const getSignals = () => getJson(`${backendBase()}/api/signals`);
// GET /api/history[?account=..][&limit=N] -> payload or null. "all" means
// unscoped (no account param). 404 (endpoint not deployed yet), non-200 and
// network failures all resolve to null via getJson.
export const getHistory = (account = "all", limit) => {
  const q = new URLSearchParams();
  if (account && account !== "all") q.set("account", account);
  if (limit != null) q.set("limit", String(limit));
  const qs = q.toString();
  return getJson(`${backendBase()}/api/history${qs ? `?${qs}` : ""}`);
};

// GET /api/strategies[?account=..][&status=open|closed][&by=ticker] -> payload
// or null. "all" means unscoped (no account param); omit status to get both
// open and closed. by="ticker" returns the per-underlying position book
// (by_ticker) instead of the open/closed strategy roll-up. 404 (endpoint not
// deployed), non-200 and network failures resolve to null via getJson — the
// Strategies section then shows its empty state.
export const getStrategies = (account = "all", status, by) => {
  const q = new URLSearchParams();
  if (account && account !== "all") q.set("account", account);
  if (status) q.set("status", status);
  if (by) q.set("by", by);
  const qs = q.toString();
  return getJson(`${backendBase()}/api/strategies${qs ? `?${qs}` : ""}`);
};

// GET /api/bars?symbol=..&timeframe=daily|weekly|monthly -> payload or null.
// 404 {"error":"no_bars_for_symbol"} (ticker has no bars file), non-200 and
// network failures all resolve to null via getJson — the chart then falls back
// to its simulated SVG series.
export const getBars = (symbol, timeframe = "daily") =>
  getJson(`${backendBase()}/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);

// GET /api/bars/overlay?symbol=.. -> the full overlay bundle (current price,
// cost basis, S/R levels per timeframe, latest journal decision) or null. 404
// when no bars file exists. The single call the live chart makes to draw its
// support/resistance lines, the suggested-strike line, cost basis and the
// conviction/recommendation badge.
export const getBarsOverlay = (symbol) =>
  getJson(`${backendBase()}/api/bars/overlay?symbol=${encodeURIComponent(symbol)}`);

// -- per-ticker notebook (plan + journal + fundamentals) --------------------
const tickerBase = (sym) => `${backendBase()}/api/ticker/${encodeURIComponent(sym)}`;
// GET the whole notebook in one call -> {symbol, plan, journal, fundamentals} or null.
export const getNotebook = (symbol) => getJson(`${tickerBase(symbol)}/notebook`);
// POST the structured plan (thesis/target/stop/notes) -> {plan} envelope or null.
export const postPlan = (symbol, plan) => postJson(`${tickerBase(symbol)}/plan`, plan);
// POST a manual journal note -> {journal} envelope or null.
export const postNote = (symbol, text) => postJson(`${tickerBase(symbol)}/note`, { text });

// GET /api/analysis[?date][?symbol] -> the nightly decision journal or null.
// Omit both to read the latest journal for every held underlying. 404/non-200/
// network failures resolve to null — the Recommendations view then shows its
// empty state.
export const getAnalysis = (date, symbol) => {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (symbol) q.set("symbol", symbol);
  const qs = q.toString();
  return getJson(`${backendBase()}/api/analysis${qs ? `?${qs}` : ""}`);
};

// GET /api/ml/roundtrips[?account][?symbol] -> the labeled closed round-trips
// journal + recomputed summary, or null. "all" means unscoped (no account
// param). A missing ML build is a valid empty payload ({roundtrips: [],
// summary: {}}); 404/non-200/network failures resolve to null via getJson — the
// Trade Analytics view then shows its "run the trade-analysis build" empty state.
export const getRoundtrips = (account = "all", symbol) => {
  const q = new URLSearchParams();
  if (account && account !== "all") q.set("account", account);
  if (symbol) q.set("symbol", symbol);
  const qs = q.toString();
  return getJson(`${backendBase()}/api/ml/roundtrips${qs ? `?${qs}` : ""}`);
};

// GET /api/ml/trade_stats[?account][?dimension] -> the Bayesian condition
// buckets + notable edges/leaks + baseline win-rate, or null. "all" means
// unscoped. A missing ML build is a valid empty payload (baseline null,
// buckets/notable []). This is a real-data-only surface (no fixture): null and
// empty payloads both drive the empty state.
export const getTradeStats = (account = "all", dimension) => {
  const q = new URLSearchParams();
  if (account && account !== "all") q.set("account", account);
  if (dimension) q.set("dimension", dimension);
  const qs = q.toString();
  return getJson(`${backendBase()}/api/ml/trade_stats${qs ? `?${qs}` : ""}`);
};

/* ---------------- payload -> view-shape mappers ---------------- */

const mapLot = (l) => ({
  account: l.account,
  symbol: l.symbol,
  date: l.date,
  shares: l.shares,
  costPerShare: l.cost_per_share,
});

const mapWashStatus = (w) => ({
  blocked: w.blocked,
  reason: w.reason,
  clearsOn: w.clears_on,
  clearsOnDate: w.clears_on_date,
  futureRisk: w.future_risk
    ? {
        account: w.future_risk.account,
        symbol: w.future_risk.symbol,
        dayOfMonth: w.future_risk.day_of_month,
        amount: w.future_risk.amount,
        cadence: w.future_risk.cadence,
      }
    : null,
});

// /api/positions -> the array util.jsx positions() produces.
export function mapPositions(payload) {
  if (!payload || !Array.isArray(payload.positions)) return null;
  return payload.positions.map((p) => {
    // Per-share current price from the aggregate (value/shares) so each lot can
    // show a real market value without a fixture quote table.
    const perShare = p.shares ? p.value / p.shares : null;
    return {
      symbol: p.symbol,
      shares: p.shares,
      value: p.value,
      cost: p.cost,
      unrl: p.unrealized,
      dayPl: p.day_pl,
      weight: p.weight,
      currency: p.currency || "USD",
      accounts: p.accounts, // array; views spread it like the fixture Set
      lots: (p.lots || []).map((l) => ({ ...mapLot(l), price: perShare })),
      overlap: p.overlap || null,
    };
  });
}

// /api/tax/wash -> { SYMBOL: washStatus } in util.jsx washStatus() shape.
export function mapWash(payload) {
  if (!payload || !payload.wash) return null;
  const out = {};
  for (const [sym, w] of Object.entries(payload.wash)) out[sym] = mapWashStatus(w);
  return out;
}

// /api/tax/tlh -> the array util.jsx tlhCandidates() produces.
export function mapTlh(payload) {
  if (!payload || !Array.isArray(payload.candidates)) return null;
  return payload.candidates.map((c) => ({
    lot: mapLot(c.lot),
    acct: c.account
      ? {
          id: c.account.id,
          name: c.account.name,
          short: c.account.short,
          type: c.account.type,
          taxable: c.account.taxable,
          lastSync: c.account.last_sync,
        }
      : null,
    unrl: c.unrealized,
    lossPct: c.loss_pct,
    status: c.status,
    wash: c.wash ? mapWashStatus(c.wash) : undefined,
    replacement: c.replacement || null,
  }));
}

// /api/allocation -> { byClass: {cls: value}, total } (util.jsx allocation()).
export function mapAllocation(payload) {
  if (!payload || !payload.by_class) return null;
  const byClass = {};
  for (const [k, v] of Object.entries(payload.by_class)) byClass[k] = v.value;
  return { byClass, total: payload.total,
           currency: payload.currency || "USD",
           byCurrency: payload.by_currency || { USD: payload.total } };
}

// /api/quotes -> a compact market band for the Dashboard's "how is the market
// doing today" question. Picks the broad-market proxies actually in the feed
// (equities + growth/small-cap) and a one-line regime read from their average
// day change. Returns null when the payload is empty/unavailable so the band
// falls back to the fixture ticker. `asOf`/`source`/`stale` ride along so the
// Dashboard can label a stale or fixture feed honestly.
const _BAND_SYMS = [
  { sym: "SPY", label: "S&P 500" },
  { sym: "QQQ", label: "Nasdaq 100" },
  { sym: "IWM", label: "Russell 2000" },
  { sym: "VTI", label: "Total Market" },
];
export function mapMarketBand(payload) {
  if (!payload || !payload.quotes) return null;
  const q = payload.quotes;
  const indexes = _BAND_SYMS
    .filter((b) => q[b.sym] && q[b.sym].day_pct != null)
    .map((b) => ({ sym: b.sym, label: b.label, price: q[b.sym].price, dayPct: q[b.sym].day_pct }));
  if (indexes.length === 0) return null;
  const avg = indexes.reduce((s, i) => s + i.dayPct, 0) / indexes.length;
  // A plain regime read from breadth + average move — no authored market call.
  const up = indexes.filter((i) => i.dayPct > 0).length;
  let regime;
  if (avg > 0.35) regime = "Broad risk-on — most proxies up";
  else if (avg < -0.35) regime = "Broad risk-off — most proxies down";
  else if (up === indexes.length) regime = "Quietly higher across the board";
  else if (up === 0) regime = "Quietly lower across the board";
  else regime = "Mixed — no clear direction";
  return { indexes, avg, regime, asOf: payload.as_of, source: payload.source, stale: !!payload.stale };
}

// /api/signals -> the data.js SIGNALS row shape the signals view consumes.
// Backend statuses (computed from quotes, never authored) map onto the
// fixture vocabulary: hit_target -> "hit-target", stopped -> "stopped",
// open -> "active"; "unquoted" (no quote for the symbol) passes through and
// gets a neutral badge in the view. pnl_pct / progress_grade ride along as
// extra fields (null when unquoted).
const SIGNAL_STATUS = { hit_target: "hit-target", stopped: "stopped", open: "active", unquoted: "unquoted" };
export function mapSignals(payload) {
  if (!payload || !Array.isArray(payload.signals)) return null;
  return payload.signals.map((g) => ({
    id: g.signal.id,
    sym: g.signal.sym,
    pattern: g.signal.pattern,
    entry: g.signal.entry,
    target: g.signal.target,
    stop: g.signal.stop,
    movePct: g.signal.move_pct,
    conf: g.signal.conf,
    time: g.signal.created_at,
    status: SIGNAL_STATUS[g.status] || g.status,
    // live-only extras
    price: g.price,
    pnlPct: g.pnl_pct,
    grade: g.progress_grade,
  }));
}

// /api/history -> the row shape the Activity view consumes. Backend order
// (newest first) is preserved as-is — no client-side re-sort. History has NO
// fixture fallback: null (malformed payload / endpoint unavailable) or an
// empty array both land on the view's "no activity imported" empty state.
export function mapHistory(payload) {
  if (!payload || !Array.isArray(payload.history)) return null;
  return payload.history.map((h) => ({
    account: h.account,
    brokerAccount: h.broker_account,
    date: h.date,
    kind: h.kind || "other",   // "equity" | "option" | "other"
    symbol: h.symbol,
    description: h.description,
    side: h.side,              // "buy" | "sell" | undefined
    qty: h.quantity,
    price: h.price,
    amount: h.amount,          // signed: buys negative, sells positive
    state: h.state,            // "filled" | "cancelled" | "open" | ...
  }));
}

// /api/strategies -> { open: [...], closed: [...] } of camelCase view rows.
// Backend order is preserved (closed already sorted newest-first). Both arrays
// default to [] when absent, so a payload with only "open" still maps cleanly.
// null (malformed payload / endpoint unavailable) drives the empty state.
const mapStrategyLeg = (l) => ({
  side: l.side,                 // "buy" | "sell"
  optionType: l.option_type,    // "call" | "put"
  strike: l.strike,
  contracts: l.contracts,
  positionType: l.position_type, // "long" | "short" (open legs)
  ratio: l.ratio,               // closed legs
  expiration: l.expiration,     // by_ticker legs carry their own expiry
  openedAt: l.opened_at,        // by_ticker legs carry their open date
  avgPrice: l.avg_price,
  mark: l.mark,
  occSymbol: l.occ_symbol,      // for matching a leg to its leg-action
});

// /api/strategies?by=ticker -> { byTicker: [...] } of camelCase position-book
// rows (all option legs of a ticker in one row, netting a diagonal's short).
// null (malformed payload / endpoint unavailable) drives the empty state.
export function mapByTicker(payload) {
  if (!payload || typeof payload !== "object") return null;
  const rows = payload.by_ticker;
  if (rows != null && !Array.isArray(rows)) return null;
  return {
    byTicker: (rows || []).map((s) => ({
      underlying: s.underlying,
      netCost: s.net_cost,             // signed debit: positive = you paid
      currentValue: s.current_value,   // may be null if a leg is unmarked
      unrealized: s.unrealized,        // null if currentValue null
      firstOpened: s.first_opened,
      lastOpened: s.last_opened,
      legCount: s.leg_count,
      hasShort: s.has_short,
      spansExpiries: s.spans_expiries, // flags diagonals/calendars
      account: s.account,
      legs: (s.legs || []).map(mapStrategyLeg),
    })),
  };
}

export function mapStrategies(payload) {
  if (!payload || typeof payload !== "object") return null;
  const open = payload.open;
  const closed = payload.closed;
  if (open != null && !Array.isArray(open)) return null;
  if (closed != null && !Array.isArray(closed)) return null;
  return {
    open: (open || []).map((s) => ({
      kind: s.kind,
      name: s.name,
      structure: s.structure,
      underlying: s.underlying,
      expiration: s.expiration,
      dte: s.dte,
      netCost: s.net_cost,           // signed debit: positive = you paid
      currentValue: s.current_value, // may be null if a leg is unmarked
      unrealized: s.unrealized,      // null if currentValue null
      account: s._vantage_account,
      legs: (s.legs || []).map(mapStrategyLeg),
    })),
    closed: (closed || []).map((s) => ({
      kind: s.kind,
      name: s.name,
      structure: s.structure,
      underlying: s.underlying,
      direction: s.direction,        // "credit" | "debit"
      price: s.price,
      multiplier: s.multiplier,
      cash: s.cash,                  // signed $ moved: buys negative
      state: s.state,                // "filled" | "cancelled" | "rejected"
      quantity: s.quantity,
      timestamp: s.timestamp,
      orderId: s.order_id,
      account: s._vantage_account,
      legs: (s.legs || []).map(mapStrategyLeg),
    })),
  };
}

/* ---------------- bars / overlay / analysis mappers ---------------- */

// A backend bar date is ISO ("2026-07-02T00:00:00Z"); Lightweight Charts wants
// a business-day string "yyyy-mm-dd" (or a UTC unix ts). Slice the date part.
const barTime = (d) => String(d).slice(0, 10);

// /api/bars -> { symbol, asOf, timeframe, bars:[{time,open,high,low,close,volume}],
// levels:{support:[{price,strength,kind}], resistance:[...]}, barCount } or null.
// `time` is the yyyy-mm-dd string Lightweight Charts' candlestick/volume series
// consume directly; open/high/low/close/volume ride through unchanged.
export function mapBars(payload) {
  if (!payload || !Array.isArray(payload.bars)) return null;
  const lv = payload.levels || {};
  return {
    symbol: payload.symbol,
    asOf: payload.as_of,
    timeframe: payload.timeframe,
    bars: payload.bars.map((b) => ({
      time: barTime(b.date),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    })),
    levels: {
      support: Array.isArray(lv.support) ? lv.support : [],
      resistance: Array.isArray(lv.resistance) ? lv.resistance : [],
    },
    firstBar: payload.first_bar,
    lastBar: payload.last_bar,
    barCount: payload.bar_count,
  };
}

// /api/bars/overlay -> the camelCase overlay the chart draws from. `analysis`
// (the latest journal decision) is passed through mapDecision so the badge and
// the strike/cost-basis price lines can read a single stable shape; null when
// the symbol was never journaled. cost_basis / levels ride through structurally.
export function mapBarsOverlay(payload) {
  if (!payload || typeof payload !== "object" || !payload.symbol) return null;
  const cb = payload.cost_basis || null;
  return {
    symbol: payload.symbol,
    asOf: payload.as_of,
    currentPrice: payload.current_price,
    lastClose: payload.last_close,
    costBasis: cb
      ? {
          equity: cb.equity ? { shares: cb.equity.shares, avgCost: cb.equity.avg_cost } : null,
          options: cb.options ? { contracts: cb.options.contracts, avgCost: cb.options.avg_cost } : null,
        }
      : null,
    levels: payload.levels || { daily: {}, weekly: {}, monthly: {} },
    analysis: payload.analysis ? mapDecision(payload.analysis) : null,
  };
}

// GET /api/ticker/{sym}/notebook -> the notebook panel's persisted side:
// {symbol, plan, journal[], fundamentals}. null (backend down) -> panel shows
// its own empty state. Numbers/strings pass through; journal payloads are
// already JSON objects. plan.target/stop are numbers or null.
export function mapNotebook(payload) {
  if (!payload || typeof payload !== "object") return null;
  const plan = payload.plan || null;
  return {
    symbol: payload.symbol,
    plan: plan
      ? { thesis: plan.thesis || "", target: plan.target ?? null, stop: plan.stop ?? null,
          notes: plan.notes || "", updatedAt: plan.updated_at || plan.updatedAt || null }
      : null,
    journal: Array.isArray(payload.journal)
      ? payload.journal.map((j) => ({ id: j.id, createdAt: j.created_at || j.createdAt,
                                      kind: j.kind, payload: j.payload || {} }))
      : [],
    fundamentals: payload.fundamentals || null,
    // Phase V analyst datasets (REST now serves them; pass through as-is).
    riskReward: payload.risk_reward || null,
    growth: payload.growth || null,
    expectations: payload.expectations || null,
    relativeStrength: payload.relative_strength || null,
    news: mapNews(payload.news),
  };
}

// Normalize the /notebook (and /api/ticker/{sym}/news) news block to the shape
// the notebook's News section renders: recent items + the headline sentiment
// lean (clearly labeled estimated). Null when the source returned nothing.
export function mapNews(news) {
  if (!news || typeof news !== "object") return null;
  const items = Array.isArray(news.items) ? news.items : [];
  const s = news.sentiment || {};
  return {
    symbol: news.symbol || null,
    items: items.map((it) => ({
      title: it.title || "",
      summary: it.summary || "",
      publisher: it.publisher || "",
      published: it.published || "",
      url: it.url || "",
      source: it.source || "",
    })),
    sentiment: {
      band: s.band || "neutral",
      score: typeof s.score === "number" ? s.score : 0,
      n: s.n_headlines ?? items.length,
      estimated: s.estimated !== false,
    },
  };
}

// One journaled PositionDecision -> the camelCase shape the Recommendations
// table and the chart badge consume. action_detail is a discriminated union
// keyed by `kind` ("sell_call" for HOLD_AND_SELL_CALL, "close" for
// CLOSE_AND_BOOK_LOSS / HOLD_WASH_BLOCKED); we surface every field either view
// needs but keep the raw object too so nothing is lost.
export function mapDecision(d) {
  if (!d || typeof d !== "object") return null;
  const ad = d.action_detail || null;
  const ev = d.evidence || {};
  return {
    symbol: d.symbol,
    asOf: d.as_of,
    currentPrice: d.current_price,
    recommendation: d.recommendation,
    rule: d.rule,
    rationale: d.rationale,
    conviction: d.conviction
      ? { label: d.conviction.label, score: d.conviction.score }
      : { label: "neutral", score: 0 },
    action: ad
      ? {
          kind: ad.kind,
          // sell_call
          suggestedStrike: ad.suggested_strike,
          strikeBasis: ad.strike_basis,
          expiryDte: ad.expiry_dte,
          estCredit: ad.est_credit,
          contracts: ad.contracts,
          currentNetCost: ad.current_net_cost,
          projectedNetCost: ad.projected_net_cost,
          basisReduction: ad.basis_reduction,
          collateral: ad.collateral,
          // close
          unrealizedLoss: ad.unrealized_loss,
          washBlocked: ad.wash_blocked,
          washReason: ad.wash_reason,
          washClearsOn: ad.wash_clears_on,
          estWeeklyCredit: ad.est_weekly_credit,
          weeksToOffset: ad.weeks_to_offset_at_est_credit,
        }
      : null,
    evidence: {
      perTf: ev.per_tf || {},
      nearestSupport: ev.nearest_support || null,
      nearestResistance: ev.nearest_resistance || null,
      brokeSupportWithMomentum: !!ev.broke_support_with_momentum,
      atSupport: ev.at_support,
      factors: ev.factors || null,
    },
    // Per-option-leg strategist actions (empty for pure equity). camelCase for
    // the SPA; matched to a rendered leg by occSymbol (or strike/expiry/type).
    legActions: Array.isArray(d.leg_actions)
      ? d.leg_actions.map((a) => ({
          occSymbol: a.occ_symbol,
          action: a.action,
          side: a.side,
          optionType: a.option_type,
          strike: a.strike,
          expiration: a.expiration,
          contracts: a.contracts,
          dte: a.dte,
          moneyness: a.moneyness,
          pctFromStrike: a.pct_from_strike,
          target: a.target || null,
          assignmentRisk: !!a.assignment_risk,
          estimated: !!a.estimated,
          rationale: a.rationale,
        }))
      : [],
  };
}

// /api/analysis -> { asOf, generatedAt, decisions:[mapDecision...] } or null.
// null (malformed payload / journal missing / endpoint down) drives the
// Recommendations view's empty state.
export function mapAnalysis(payload) {
  if (!payload || !Array.isArray(payload.decisions)) return null;
  return {
    asOf: payload.date || payload.as_of,
    generatedAt: payload.generated_at,
    decisions: payload.decisions.map(mapDecision).filter(Boolean),
  };
}

/* ---------------- Mira client (:8080) ---------------- */

export const miraHealth = () => getJson(`${miraBase()}/health`);

// GET /explain?correlation_id=... -> {"records": [...]} grounding trace for
// one streamed turn (the id arrives on the turn's `done` SSE event).
// 404/503/unreachable all resolve to null via getJson.
export const getExplanation = (correlationId) =>
  getJson(`${miraBase()}/explain?correlation_id=${encodeURIComponent(correlationId)}`);

// GET /insights?domain=advisor -> report or null (404 unknown domain,
// 503 unconfigured, network failure — all null).
export const getInsights = () => getJson(`${miraBase()}/insights?domain=advisor`);

// Normalize the Mira advisor report for display. This is the ONE live fetch
// that used to bind straight into JSX — each observation's `evidence` is a
// RAW JSON STRING of the tool result (e.g. the whole wash table), which dumped
// as `{"as_of":...}` on screen. We keep the human `detail`, pull just the
// provenance SOURCE out of evidence as a citation, drop the raw blob, and
// surface `suggestions` (previously not rendered). Everything is coerced to a
// display string so an object can never render as `[object Object]`.
const _asText = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(_asText).filter(Boolean).join(" · ");
  return String(v);
};
const _sourceOf = (evidence) => {
  // evidence is usually a JSON string of the raw tool result; surface only its
  // provenance source (the citation), never the payload.
  if (!evidence) return "";
  let ev = evidence;
  if (typeof ev === "string") {
    try { ev = JSON.parse(ev); } catch { return ev.length > 80 ? "" : ev; }
  }
  const prov = ev && ev.provenance;
  if (prov && prov.source_id) {
    const id = String(prov.source_id).split("#")[1] || prov.source_id;
    return `source: ${id}`;
  }
  return "";
};
export function mapInsights(payload) {
  if (!payload || typeof payload !== "object") return null;
  const r = payload.report || payload; // tolerate an envelope
  return {
    summary: _asText(r.summary),
    confidence: _asText(r.confidence),
    observations: Array.isArray(r.observations)
      ? r.observations.map((o) => ({
          topic: _asText(o.topic),
          detail: _asText(o.detail),
          source: _sourceOf(o.evidence),
        }))
      : [],
    suggestions: Array.isArray(r.suggestions) ? r.suggestions.map(_asText).filter(Boolean) : [],
    caveats: _asText(r.caveats),
  };
}

// One stable thread id per page load.
let _threadId = null;
export function threadId() {
  if (!_threadId) _threadId = `vantage-${Date.now()}`;
  return _threadId;
}

// A stable thread id per symbol per page load, so each ticker's notebook chat
// keeps its own conversation context (separate from the global chat).
const _symThreads = {};
export function symbolThreadId(sym) {
  const key = (sym || "").toUpperCase();
  if (!_symThreads[key]) _symThreads[key] = `vantage-${key}-${Date.now()}`;
  return _symThreads[key];
}

// Parse one SSE frame ("event: <kind>\ndata: <json>") into {kind, ...data}.
function parseSseFrame(frame) {
  let kind = null;
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) kind = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!kind && dataLines.length === 0) return null;
  let data = {};
  if (dataLines.length) {
    const raw = dataLines.join("\n");
    try { data = JSON.parse(raw); } catch (e) { data = { text: raw }; }
  }
  if (typeof data !== "object" || data === null) data = { text: String(data) };
  return { ...data, kind: kind || "message" };
}

// POST {miraUrl}/turn and stream the SSE response incrementally.
// Calls onEvent({kind, ...data}) per frame; guarantees exactly one terminal
// event (done or error) unless aborted. Returns an abort function.
export function streamTurn(prompt, thread, onEvent) {
  const ctrl = new AbortController();
  let terminal = false;
  const emit = (evt) => {
    if (terminal || !evt) return;
    if (evt.kind === "done" || evt.kind === "error") terminal = true;
    try { onEvent(evt); } catch (e) { /* a view error must not kill the stream */ }
  };

  (async () => {
    let res;
    try {
      res = await fetch(`${miraBase()}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, thread_id: thread }),
        signal: ctrl.signal,
      });
    } catch (e) {
      emit({ kind: "error", code: "unreachable", message: "Mira is not reachable" });
      return;
    }
    if (!res.ok || !res.body) {
      emit({ kind: "error", code: "unreachable", message: `Mira answered ${res.status}` });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf("\n\n")) !== -1) {
          emit(parseSseFrame(buf.slice(0, cut)));
          buf = buf.slice(cut + 2);
        }
      }
      emit(parseSseFrame(buf)); // unterminated tail frame, if any
      emit({ kind: "done" });   // stream ended without an explicit done frame
    } catch (e) {
      emit({ kind: "error", code: "unreachable", message: "stream interrupted" });
    }
  })();

  return () => { terminal = true; ctrl.abort(); };
}

// POST {miraUrl}/analyze — the multi-facet analysis graph. Fans the ticker
// across technical/fundamental/news/advisor facets and returns an LLM-synthesized
// grounded answer. Non-streaming JSON (synthesis is written whole). Returns null
// on any failure (Mira down / bad symbol) so the caller can degrade to /turn.
export async function analyzeSymbol(symbol, question) {
  const base = miraBase();
  if (!base) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000); // synthesis on 14b can be slow
  try {
    const res = await fetch(`${base}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: (symbol || "").toUpperCase(), question: question || undefined }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return mapAnalyze(await res.json());
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// The daily 0DTE SPX playbook. Prefers Mira's /playbook (narrated: templated
// draft + LLM plain-English polish); falls back to Vantage's /api/spx/playbook
// (scaffold only) when Mira is down so the level ladder + setups still render.
// Returns {available, narrative, draft, scaffold, session} or {available:false}.
export async function getPlaybook(date, { refresh = false, symbol = "SPX" } = {}) {
  // Mira caches the narrated playbook in-memory keyed by date (no TTL). After a
  // Vantage recompute, pass refresh=true so Mira re-fetches the fresh scaffold +
  // re-narrates — otherwise the UI reads Mira's stale cache and shows old GEX.
  const params = [];
  if (date) params.push(`date=${encodeURIComponent(date)}`);
  if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
  if (refresh) params.push("refresh=1");
  const q = params.length ? `?${params.join("&")}` : "";
  // Mira only narrates SPX; QQQ/IWM read the Vantage scaffold directly.
  const mira = symbol === "SPX" ? miraBase() : null;
  if (mira) {
    try {
      const res = await fetch(`${mira}/playbook${q}`, { signal: _timeout(90000) });
      if (res.ok) {
        const p = await res.json();
        if (p && p.available) return mapPlaybook(p);
      }
    } catch (e) { /* fall through to Vantage scaffold */ }
  }
  // Vantage fallback — scaffold only, no LLM narrative. Generous timeout: a cold
  // playbook read can re-fetch quotes/bars, exceeding the default 2.5s.
  const v = await getJson(`${backendBase()}/api/spx/playbook${q}`, { timeoutMs: 20000 });
  if (v && v.available) return mapPlaybook({ ...v, narrative: null });
  return { available: false };
}

function _timeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// The playbook as a TradingView Pine v5 script (rendered by Vantage from the
// stored scaffold). Returns {available, session, script} or {available:false}.
export async function getPlaybookPine(date, symbol = "SPX") {
  const params = [];
  if (date) params.push(`date=${encodeURIComponent(date)}`);
  if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
  const q = params.length ? `?${params.join("&")}` : "";
  // 20s timeout: the endpoint renders the full Pine script from the scaffold and
  // a cold call can trigger a quote re-fetch — the default 2.5s can abort it and
  // surface a spurious "no script" error in the export modal.
  const v = await getJson(`${backendBase()}/api/spx/playbook/pine${q}`, { timeoutMs: 20000 });
  if (v && v.available) return { available: true, session: v.session, script: v.script };
  return { available: false };
}

// The PREFILLED reclaim-strategy indicator (this symbol's GEX levels baked into
// the input), as text for the UI to copy — the reclaim counterpart to
// getPlaybookPine. No disk file: /api/spx/reclaim/pine renders from the stored
// scaffold and returns the script.
export async function getReclaimPine(date, symbol = "SPX") {
  const params = [];
  if (date) params.push(`date=${encodeURIComponent(date)}`);
  if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
  const q = params.length ? `?${params.join("&")}` : "";
  const v = await getJson(`${backendBase()}/api/spx/reclaim/pine${q}`, { timeoutMs: 20000 });
  if (v && v.available) {
    return { available: true, session: v.session, script: v.script,
             gexLevels: v.gex_levels, prefilled: v.prefilled };
  }
  return { available: false };
}

// The COACH indicator — a live discipline coach with the session's GEX + pivot
// levels baked in (WAIT/ENTER/EXIT/HOLD/WARN over VWAP/volume/RSI). Text for
// the UI to copy into TradingView; no disk file.
export async function getCoachPine(date, symbol = "SPX") {
  const params = [];
  if (date) params.push(`date=${encodeURIComponent(date)}`);
  if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
  const q = params.length ? `?${params.join("&")}` : "";
  const v = await getJson(`${backendBase()}/api/spx/coach/pine${q}`, { timeoutMs: 20000 });
  if (v && v.available) return { available: true, session: v.session, script: v.script };
  return { available: false };
}

// Stage an order ticket for a reclaim trade at a playbook level. STAGED ONLY:
// the server computes entry/stop/targets + risk-based qty (index symbols come
// back rescaled into the tradeable proxy ETF, e.g. SPX→SPY) — the operator
// reviews and places it in their broker; Vantage never places orders (ADR-010).
export async function getTicket(symbol, side, level, risk = 500, entry = null) {
  const q = `symbol=${encodeURIComponent(symbol)}&side=${encodeURIComponent(side)}` +
            `&level=${encodeURIComponent(level)}&risk=${encodeURIComponent(risk)}` +
            (entry ? `&entry=${encodeURIComponent(entry)}` : "");
  // 20s: an index ticket fetches a live proxy quote (SPY/QQQ/IWM) to rescale.
  const v = await getJson(`${backendBase()}/api/ticket?${q}`, { timeoutMs: 20000 });
  if (v && v.available) return { available: true, ticket: v.ticket, text: v.text };
  return { available: false, note: (v && v.note) || "ticket unavailable" };
}

// Execute a staged reclaim ticket (ADR-010 v2 carve-out). The server
// RECOMPUTES the ticket from symbol/side/level/risk — client prices are never
// trusted. Dry-run unless body.live is true AND the operator set
// VANTAGE_LIVE_OK=1 server-side. Returns the envelope verbatim:
// {available, ticket, execution: {mode, legs, warnings, managed_position_id}}.
export async function executeTicket(body) {
  const v = await postJson(`${backendBase()}/api/ticket/execute`, body,
                           { timeoutMs: 60000 }); // live path waits for the fill
  if (!v) return { available: false, note: "backend unreachable" };
  return v;
}

// Managed-exit positions (ADR-010 v3): what the exit monitor is protecting.
// `mergeBroker` also returns the ACTUAL broker positions with a `managed`
// flag — an unmanaged position has no monitor stop, which is the thing worth
// seeing.
export async function getExits(status, { mergeBroker = false } = {}) {
  const p = [];
  if (status) p.push(`status=${encodeURIComponent(status)}`);
  if (mergeBroker) p.push("merge_broker=1");
  const q = p.length ? `?${p.join("&")}` : "";
  const v = await getJson(`${backendBase()}/api/exits${q}`);
  if (!v) return { positions: [], broker: [], live_gate: false, unreachable: true };
  return { positions: v.positions || [], broker: v.broker || [], live_gate: !!v.live_gate };
}

// One exit-monitor pass NOW (re-arm stops, detect fills, swaps/ratchets —
// reduce-only by construction). Returns {available, actions: [...]}.
export const exitsTick = () =>
  postJson(`${backendBase()}/api/exits/tick`, {}, { timeoutMs: 60000 });

// Release one position from monitor control (its broker-side stop is LEFT
// RESTING — disarm never removes protection).
export const disarmExit = (id) =>
  postJson(`${backendBase()}/api/exits/${encodeURIComponent(id)}/disarm`, {});

// Strategy lifecycle (ADR-015): each strategy's stage + gate (paper win-rate vs
// frozen backtest baseline) + caps; operator promote/pause/resume; one autonomous
// driver pass (dry-run unless the env gates are armed); the immutable audit trail.
export const getLifecycle = () => getJson(`${backendBase()}/api/lifecycle`);
export const promoteStrategy = (sid, body) =>
  postJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/promote`, body);
export const pauseStrategy = (sid, body = {}) =>
  postJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/pause`, body);
export const resumeStrategy = (sid) =>
  postJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/resume`, {});
export const lifecycleTick = (live = false) =>
  postJson(`${backendBase()}/api/lifecycle/tick`, { live }, { timeoutMs: 60000 });
export const getStrategyAudit = (sid) =>
  getJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/audit`);

// Reclaim signal bot (Telegram): status, config (stored in OUR meta table;
// container env wins when set), one poll pass, and the signal↔live
// correlation report.
export const getBotStatus = () => getJson(`${backendBase()}/api/reclaim-bot/status`);
export const saveBotConfig = (body) =>
  postJson(`${backendBase()}/api/reclaim-bot/config`, body);
export const botPoll = () =>
  postJson(`${backendBase()}/api/reclaim-bot/poll`, {}, { timeoutMs: 120000 });
export const getBotPerformance = () =>
  getJson(`${backendBase()}/api/reclaim-bot/performance`);

// Latest nightly pipeline snapshot(s): per-job ok/duration/tail.
export const getNightlyStatus = (limit = 1) =>
  getJson(`${backendBase()}/api/nightly/status?limit=${limit}`);

// What I ACTUALLY traded on a day — reconstructed from the broker fills already
// in the store. The factual half of a journal entry; no typing, no broker call.
export const getSessionActivity = (day, underlying) => {
  const q = new URLSearchParams();
  if (day) q.set("day", day);
  if (underlying) q.set("underlying", underlying);
  return getJson(`${backendBase()}/api/journal/activity?${q.toString()}`,
                 { timeoutMs: 20000 });
};

// Realized P&L per day for a set of dates (cheap — fills only), so the day
// strip can tint each pill by outcome. Omit underlying → sums all tickers.
export const getDayPnl = (days, underlying) => {
  const q = new URLSearchParams({ days: days.join(",") });
  if (underlying) q.set("underlying", underlying);
  return getJson(`${backendBase()}/api/journal/day-pnl?${q.toString()}`, { timeoutMs: 15000 });
};

// The full DNA of one trade (step 1: pure Vantage data — price action, volume,
// technicals, level correlation, forecast). `trade` is the index into the day's
// session-activity trade list. Feeds the Mira trade-analyst (step 2).
export const getTradeDna = (day, trade, underlying = "SPX") =>
  getJson(`${backendBase()}/api/journal/trade-dna?day=${encodeURIComponent(day)}` +
          `&trade=${trade}&underlying=${encodeURIComponent(underlying)}`, { timeoutMs: 30000 });

// Freeze a trade's DNA snapshot + Mira's read into Vantage — permanent record,
// survives 1-minute bars ageing out of yfinance.
export const saveTradeAnalysis = (body) =>
  postJson(`${backendBase()}/api/journal/trade-analysis`, body);

// ── Journal Analysis (the compounding aggregate self-assessment) ────────────
// The deterministic bundle (scores, pattern census, citations, prior analysis)
// + the ready DeepSeek prompt for a date window. The client streams Mira with
// the prompt, then saves the result via saveJournalAnalysis.
export const getJournalAnalysisBundle = (from, to, underlying = "SPX") =>
  getJson(`${backendBase()}/api/journal/analysis/bundle?window_from=${encodeURIComponent(from)}` +
          `&window_to=${encodeURIComponent(to)}&underlying=${encodeURIComponent(underlying)}`,
          { timeoutMs: 20000 });

// Store one Journal Analysis run (tagged period + window) so it compounds.
export const saveJournalAnalysis = (body) =>
  postJson(`${backendBase()}/api/journal/analysis`, body);

// Market tone vs trade tone, side by side (15-min buckets + today's entries
// marked with/against) — the cockpit's "you are doing it again" comparison.
export const getCoachTone = (day, symbol = "SPX") =>
  getJson(`${backendBase()}/api/coach/tone?symbol=${encodeURIComponent(symbol)}`
          + (day ? `&day=${encodeURIComponent(day)}` : ""), { timeoutMs: 30000 });

// The 0DTE implied-vs-realized vol read (odte_research Phase A) — ATM straddle
// from the recorded chain vs the realized baseline → SELL / BUY / STAND DOWN.
export const getOdteRead = (underlying = "SPY") =>
  getJson(`${backendBase()}/api/odte/read?underlying=${encodeURIComponent(underlying)}`,
          { timeoutMs: 30000 });

// The forecast prompt — hardened after the 2026-07-21 post-mortem (short call
// on a +19.5-over-VWAP tape, built on a suppressed setup, born-invalidated).
// The DISCIPLINE block encodes the three failure modes as hard rules; the
// deterministic facts in the snapshot always outrank narrative priors.
export const buildForecastPrompt = (symbol, ref) =>
  `What will ${symbol} price do from here? Reason over the snapshot and give a `
  + `structured, scoreable forecast (bias, expected path, level targets, `
  + `invalidation, confidence).\n`
  + `DISCIPLINE (hard rules):\n`
  + `1. CITE the snapshot's regime + technicals VERBATIM (vs_vwap_pt, rsi, `
  + `draw.dir). Never restate a relationship the numbers contradict.\n`
  + `2. If ict_htf.present is false, there IS NO hourly setup — you must not `
  + `claim one or use its levels; say it was suppressed and why.\n`
  + `3. SANITY CHECK before answering: a down bias requires invalidation ABOVE `
  + `current price; an up bias requires it BELOW. If your setup is already `
  + `beyond its invalidation at current price, output bias "neutral" and say `
  + `"stand down — no valid setup". Standing down is a first-class forecast.\n`
  + `4. Negative gamma amplifies BOTH directions — below-the-flip on a risk-on `
  + `tape means faster moves UP toward the flip, not a short signal.\n${ref}`;

// All stored per-trade desk reviews for a day (the cockpit's review feed).
export const getTradeAnalyses = (day) =>
  getJson(`${backendBase()}/api/journal/trade-analyses?day=${encodeURIComponent(day)}`);

// Persisted Analyze-today day syntheses: save one, list a day's history.
export const saveDayReview = (body) =>
  postJson(`${backendBase()}/api/journal/day-review`, body);
export const getDayReviews = (day) =>
  getJson(`${backendBase()}/api/journal/day-review?day=${encodeURIComponent(day)}`);

// The trade_keys already analyzed for a day — so "Analyze today" can skip them
// (and skip the costly per-trade DNA rebuild) instead of re-running every trade.
export const getAnalyzedKeys = (day) =>
  getJson(`${backendBase()}/api/journal/analyzed-keys?day=${encodeURIComponent(day)}`);

// The DAY-synthesis bundle + Mira prompt for one day's whole book (direction /
// time / allocation patterns a per-trade review can't see). The client streams
// Mira with the prompt to render the book-level read (not persisted).
export const getDayReviewBundle = (day, underlying = "SPX") =>
  getJson(`${backendBase()}/api/journal/day-review-bundle?day=${encodeURIComponent(day)}` +
          `&underlying=${encodeURIComponent(underlying)}`, { timeoutMs: 180000 });

// Recorded Journal Analyses, newest window first (the history + score trend).
export const getJournalAnalyses = (underlying = "SPX") =>
  getJson(`${backendBase()}/api/journal/analysis?underlying=${encodeURIComponent(underlying)}`);

// ── chart-first: multi-timeframe candles for any symbol ──────────────────────
export const getChart = (symbol, tf = "5m", days = 15) =>
  getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}?tf=${encodeURIComponent(tf)}&days=${days}`,
    { timeoutMs: 20000 });
// Manual refresh — force-refetch the source bars for this symbol+tf so new candles
// appear, then the caller re-pulls getChart.
// days: 1 = the ↻ quick refresh (today); ~30 = load a fresh ticker's full window.
export const refreshChart = (symbol, tf = "5m", days = 1) =>
  postJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/refresh`, { tf, days },
    { timeoutMs: 60000 });
// Chart drawings — persisted per-symbol annotations (Mira-readable context).
export const getDrawings = (symbol) =>
  getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/drawings`);
export const saveDrawing = (symbol, drawing) =>
  postJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/drawings`, drawing);
export const deleteDrawing = (symbol, id) =>
  postJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/drawings`, { delete: id });
// Vantage-DNA layers (coach levels / ICT / liquidity / draw / prior / GEX) for a symbol.
export const getLayers = (symbol) =>
  getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/layers`, { timeoutMs: 20000 });
// The investor's own context for a symbol: cost basis + plan target/stop (Position layer).
export const getPosition = (symbol) =>
  getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/position`, { timeoutMs: 15000 });
// The latest stored forecast for a symbol (target/invalidation/path), chart-ready.
export const getChartForecast = (symbol) =>
  getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/forecast`, { timeoutMs: 20000 });
// Saved replay runs (read-only — no Mira). List summaries + one run's forecasts+scores.
export const getReplayRuns = (limit = 40) =>
  getJson(`${backendBase()}/api/replay/runs?limit=${limit}`, { timeoutMs: 20000 });
export const getReplayRun = (runId) =>
  getJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}`, { timeoutMs: 20000 });

// ── forecast-analyst loop (any ticker) ────────────────────────────────────────────────
// The chart-centric snapshot (price + coach levels + technicals + ICT).
export const getSpxSnapshot = (day, asOf, symbol = "SPX") =>
  getJson(`${backendBase()}/api/spx/snapshot?symbol=${encodeURIComponent(symbol)}`
    + (day ? `&day=${encodeURIComponent(day)}` : "")
    + (asOf ? `&as_of=${encodeURIComponent(asOf)}` : ""));
// Persist a forecast the SPA generated via Mira's forecast_analyst.
export const saveSpxForecast = (body) =>
  postJson(`${backendBase()}/api/spx/forecast`, body);
// Stored forecasts (newest first), each with its score if scored.
export const getSpxForecasts = (day, symbol = "SPX", limit = 50) =>
  getJson(`${backendBase()}/api/spx/forecast?symbol=${encodeURIComponent(symbol)}`
    + (day ? `&day=${encodeURIComponent(day)}` : "") + `&limit=${limit}`);
// Grade a stored forecast against the elapsed price action.
export const scoreSpxForecast = (fid) =>
  postJson(`${backendBase()}/api/spx/forecast/${fid}/score`, {});
// On-demand: compute the playbook levels + seed 1m bars for a symbol.
export const prepareSpx = (symbol, days = 5) =>
  postJson(`${backendBase()}/api/spx/prepare`, { symbol, days });
// Light intraday refresh — re-fetch today's 1m bars (force) so the snapshot is
// ~current. Used by the 5-min auto-poll and refresh-then-forecast.
export const refreshSpx = (symbol) =>
  postJson(`${backendBase()}/api/spx/refresh`, { symbol });

// ── ICT Scanner ──────────────────────────────────────────────────────────────
// The latest stored scan result (ranked hits + universe status). Read-only.
export const getScanner = (scanner = "ict_htf") =>
  getJson(`${backendBase()}/api/scanner?scanner=${encodeURIComponent(scanner)}`,
    { timeoutMs: 20000 });
// Kick off a THROTTLED BACKGROUND scan (returns immediately; poll getScanner for
// running→complete). `refreshUniverse` re-resolves the constituent lists.
export const refreshScanner = (scanner = "ict_htf", refreshUniverse = false) =>
  postJson(`${backendBase()}/api/scanner/refresh`,
    { scanner, refresh_universe: refreshUniverse }, { timeoutMs: 20000 });
// Add / remove a manual ad-hoc ticker the scanner always includes.
export const addScannerTicker = (sym) =>
  postJson(`${backendBase()}/api/scanner/tickers`, { add: sym }, { timeoutMs: 30000 });
export const removeScannerTicker = (sym) =>
  postJson(`${backendBase()}/api/scanner/tickers`, { remove: sym }, { timeoutMs: 30000 });

// ── Replay Forecast (ticker-neutral) ─────────────────────────────────────────
// Plan a run: primes the day's 1m bars if missing (may fetch → longer timeout),
// enumerates the as_of step grid, mints a run_id. available=false out of window.
export const planReplay = (day, symbol = "SPX", premarket = false, stepMin = 15) =>
  postJson(`${backendBase()}/api/replay/plan`,
    { day, symbol, premarket, step_min: stepMin }, { timeoutMs: 60000 });
// Saved replay runs, newest first — the picker list (summary per run).
export const getReplays = (limit = 40) =>
  getJson(`${backendBase()}/api/replay/runs?limit=${limit}`, { timeoutMs: 20000 });
// A run's saved forecasts (chronological) + persisted scores + calibration.
export const getReplay = (runId) =>
  getJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}`, { timeoutMs: 20000 });
// Grade EVERY forecast of the run with CODE (score_forecast). Mira-free.
export const scoreReplay = (runId) =>
  postJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}/score`, {});
// Compute + persist the run's deterministic calibration (grader-owned memory).
// `body` may carry {patterns, narrative} from a completed grade.
export const calibrateReplay = (runId, body = {}) =>
  postJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}/calibration`, body);

// The positions that matter while trading: reclaim proxies you actually hold,
// each flagged with whether the exit monitor is protecting it.
export const getTradeablePositions = () =>
  getJson(`${backendBase()}/api/positions/tradeable`);

// Regenerate the playbook NOW from the latest data (fresh bars + Sentinel
// artifacts), outside the nightly job. POST; returns the new scaffold via
// mapPlaybook, or null on failure.
export async function recomputePlaybook(asOf, symbol = "SPX") {
  const base = backendBase();
  if (!base) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000); // fresh bar fetch can be slow
  try {
    const body = {};
    if (asOf) body.as_of = asOf;
    if (symbol && symbol !== "SPX") body.symbol = symbol;
    const res = await fetch(`${base}/api/spx/playbook/recompute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const p = await res.json();
    return p && p.available ? mapPlaybook({ ...p, narrative: null }) : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Normalize a playbook payload (from Mira or Vantage) to the shape the panel
// renders: the narrative (or draft), plus the structured scaffold pieces.
export function mapPlaybook(p) {
  if (!p || typeof p !== "object") return { available: false };
  const s = p.scaffold || {};
  return {
    available: true,
    session: p.session || s.session || null,
    narrative: p.narrative || p.draft || null,
    regime: s.regime || {},
    // sector rotation (market_context) — ranked by 20d return for the Market context card
    sectors: Array.isArray(s.sectors) ? s.sectors : [],
    levelLadder: Array.isArray(s.level_ladder) ? s.level_ladder : [],
    setups: Array.isArray(s.setups) ? s.setups : [],
    // durable memory levels (respected across many sessions) + confluence zones
    // (≥2 dimensions stacking) — the LuxAlgo-style features added to the scaffold.
    durable: Array.isArray(s.durable) ? s.durable : [],
    confluence: Array.isArray(s.confluence) ? s.confluence : [],
    // the compact table carries the one-line read, volume + structure notes.
    structureNote: (s.table && s.table.structure_note) || "",
    volumeNote: (s.table && s.table.volume_note) || "",
    catalysts: s.catalysts || {},
    opex: s.opex || {},
    edges: s.edges || {},
    caveats: Array.isArray(s.caveats) ? s.caveats : [],
    missing: Array.isArray(s.missing) ? s.missing : [],
  };
}

// ── AMP futures analysis (win-rate by condition, reconciled vs broker) ──────

// GET the futures win-rate analysis. Generous timeout: the read pairs round-trips
// and (unless alignment=false) fetches NQ bars, which can be slow on a cold call.
export async function getFuturesAnalysis({ contract, alignment = true } = {}) {
  const params = [];
  if (contract) params.push(`contract=${encodeURIComponent(contract)}`);
  if (!alignment) params.push("alignment=false");
  const q = params.length ? `?${params.join("&")}` : "";
  const v = await getJson(`${backendBase()}/api/futures/analysis${q}`, { timeoutMs: 30000 });
  return mapFuturesAnalysis(v);
}

// POST to (re)import the AMP CSVs, then return the fresh analysis.
export async function importFutures() {
  const base = backendBase();
  if (!base) return { available: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(`${base}/api/futures/import`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), signal: ctrl.signal,
    });
    if (!res.ok) return { available: false };
    return mapFuturesAnalysis(await res.json());
  } catch (e) {
    return { available: false };
  } finally {
    clearTimeout(t);
  }
}

// Normalize the futures analysis payload for the Futures screen. The backend
// already sends analysis-shaped JSON; we just guard the fields the view reads.
export function mapFuturesAnalysis(p) {
  if (!p || typeof p !== "object" || !p.available) {
    return { available: false, note: (p && p.note) || null };
  }
  return {
    available: true,
    contract: p.contract || null,
    overall: p.overall || {},
    baselineWinRate: p.baseline_win_rate ?? null,
    equityCurve: Array.isArray(p.equity_curve) ? p.equity_curve : [],
    drawdown: p.drawdown || {},
    risk: p.risk || { available: false },
    buckets: Array.isArray(p.buckets) ? p.buckets : [],
    notable: Array.isArray(p.notable) ? p.notable : [],
    orderBehavior: p.order_behavior || { available: false },
    recommendations: p.recommendations || { rules: [], coaching: [], watch: [] },
    reconciliation: p.reconciliation || {},
    roundtrips: Array.isArray(p.roundtrips) ? p.roundtrips : [],
    projection: p.projection || { available: false },
    tzNote: p.tz_note || "",
  };
}

// ── paper trading (SPY proxy, no money) ──────────────────────────────────────

export async function getPaper(symbol = "SPX") {
  const q = symbol && symbol !== "SPX" ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const v = await getJson(`${backendBase()}/api/paper${q}`, { timeoutMs: 30000 });
  return v && v.available ? v : { available: false, note: v && v.note };
}

// The scanner debit-spread book — its own track record, never mixed with the SPX
// reclaim record (different P&L basis). Auto-logged from A+ scanner setups.
export async function getSpreadBook() {
  const v = await getJson(`${backendBase()}/api/paper/spreads`, { timeoutMs: 30000 });
  return v && v.available ? v : { available: false, note: v && v.note };
}

async function _paperPost(path, body) {
  const base = backendBase();
  if (!base) return { available: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${base}/api/paper/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}), signal: ctrl.signal,
    });
    if (!res.ok) return { available: false };
    return await res.json();
  } catch (e) {
    return { available: false };
  } finally {
    clearTimeout(t);
  }
}

// The ticket carries its own `underlying`; settle/close take a symbol so the
// returned view is for the underlying currently shown.
export const openPaperTrade = (ticket) => _paperPost("open", ticket);
export const settlePaper = (symbol = "SPX") => _paperPost("settle", { symbol });
export const closePaperTrade = (id, spyExit, symbol = "SPX") =>
  _paperPost("close", { id, spy_exit: spyExit, symbol });

// ── chart-snapshot journal (forecast vs outcome) ─────────────────────────────

export async function getJournal(symbol = "SPX") {
  const q = symbol && symbol !== "SPX" ? `?symbol=${encodeURIComponent(symbol)}` : "";
  const v = await getJson(`${backendBase()}/api/journal${q}`, { timeoutMs: 20000 });
  return v && v.available ? v : { available: false, note: v && v.note };
}

// Attach a reference chart to a journal entry. When `attachTo` (a snapshot id) is
// given, the image attaches to THAT existing entry (drop today's chart onto
// today's row) — no new entry. Otherwise a NEW entry is created, freezing the
// forecast picked by `forecastKind`: "prior" (last night's) or "live" (today's).
// `fileOrBlob` may be null for a data-only new entry.
export async function uploadJournal(fileOrBlob, note, forecastKind = "prior", attachTo = null, symbol = "SPX") {
  const base = backendBase();
  if (!base) return { available: false };
  const fd = new FormData();
  if (fileOrBlob) fd.append("image", fileOrBlob, fileOrBlob.name || "chart.png");
  fd.append("note", note || "");
  fd.append("forecast_kind", forecastKind);
  fd.append("symbol", symbol || "SPX");
  if (attachTo != null) fd.append("attach_to", String(attachTo));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${base}/api/journal/upload`, {
      method: "POST", body: fd, signal: ctrl.signal,
    });
    if (!res.ok) return { available: false };
    return await res.json();
  } catch (e) {
    return { available: false };
  } finally {
    clearTimeout(t);
  }
}

async function _journalPost(path, body) {
  const base = backendBase();
  if (!base) return { available: false };
  try {
    const res = await fetch(`${base}/api/journal/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return res.ok ? await res.json() : { available: false };
  } catch (e) { return { available: false }; }
}

// Ensure today's entry exists (auto-created, last night's forecast frozen) and
// is re-scored against live price. Call on page open; idempotent (one per
// underlying/day). Pass a symbol for one underlying, or omit for all three.
export const ensureTodayJournal = (symbol) => _journalPost("ensure_today", symbol ? { symbol } : {});
export const scoreJournal = () => _journalPost("score", {});
export const deleteJournal = (id) => _journalPost("delete", { id });
// Save the structured trade-action log for a snapshot. `entry` is an object of
// {action, entry, exit, result, lesson, notes}. Passing an empty object clears it.
export const saveJournalEntry = (id, entry) => _journalPost("entry", { id, entry });
// The image URL for a snapshot (served by the backend).
export const journalImageUrl = (id) => `${backendBase()}/api/journal/image/${id}`;

// Normalize the /analyze payload to what the notebook renders: the synthesized
// prose plus a compact per-facet map (so the UI can show which facets grounded
// the answer). `correlationId` is surfaced when present for the sources toggle.
export function mapAnalyze(payload) {
  if (!payload || typeof payload !== "object") return null;
  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    query: payload.query || "",
    synthesis: typeof payload.synthesis === "string" ? payload.synthesis : "",
    facets: results.map((r) => ({
      domain: r.domain || "?",
      error: r.error || (r.answer && r.answer.status === "tool_error" ? r.answer.detail || "tool error" : null),
    })),
    correlationId: payload.correlation_id || null,
  };
}

/* ---------------- React glue ---------------- */

// Progressive enhancement: state starts as `fallback` (fixtures); the fetcher
// fires on mount and whenever `deps` change; live data swaps in only when the
// fetch produced a non-null payload. Views never see an error state.
// Live data with a demo fixture fallback. The fixture is shown until live data
// resolves (so a normal load never flashes empty). But once this hook has
// succeeded at least once, a later NULL result is a real outage — the fallback
// then blanks (returns [] / null) so the outage surfaces as an empty state
// rather than silently reverting to demo data that looks real. `blankOnOutage`
// opts a surface into this (accounts/positions); pure-demo surfaces leave it off.
export function useLive(fetcher, fallback, deps = [], { blankOnOutage = false } = {}) {
  const [liveData, setLiveData] = React.useState(null);
  const [outage, setOutage] = React.useState(false);
  // `loading` = a fetch is in flight (so the UI can show a subtle refresh bar).
  const [loading, setLoading] = React.useState(true);
  const everLive = React.useRef(false);
  React.useEffect(() => {
    let alive = true;
    setLiveData(null);
    setLoading(true);
    Promise.resolve()
      .then(fetcher)
      .then((d) => {
        if (!alive) return;
        if (d != null) { everLive.current = true; setLiveData(d); setOutage(false); }
        else if (everLive.current) { setOutage(true); }
      })
      .catch(() => { if (alive && everLive.current) setOutage(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  if (liveData != null) return { data: liveData, isLive: true, outage: false, loading };
  const blanked = blankOnOutage && outage;
  const fb = blanked ? (Array.isArray(fallback) ? [] : null) : fallback;
  return { data: fb, isLive: false, outage: blanked, loading };
}
