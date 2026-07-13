(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // src/data.js
  var NOTIF_TYPES = {
    tlh: { label: "Tax-loss harvesting", accent: "teal", icon: "\u{1F33E}" },
    wash: { label: "Wash-sale warnings", accent: "orange", icon: "\u26A0\uFE0F" },
    price: { label: "Price & AI alerts", accent: "blue", icon: "\u{1F4C8}" },
    drift: { label: "Allocation drift", accent: "purple", icon: "\u2696\uFE0F" },
    system: { label: "Account sync", accent: "cyan", icon: "\u{1F504}" }
  };
  var ALLOCATION_TARGETS = { usEquity: 70, intlEquity: 10, bonds: 15, cash: 5 };
  var ASSET_CLASSES = {
    usEquity: { label: "US Equity", color: "#2e68fd" },
    intlEquity: { label: "International", color: "#0d9488" },
    bonds: { label: "Bonds", color: "#932cfa" },
    cash: { label: "Cash", color: "#ca8a04" }
  };

  // src/util.jsx
  var usd = (n, digits = 0) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  var _LOCALE = {
    USD: "en-US",
    INR: "en-IN",
    GBP: "en-GB",
    EUR: "de-DE",
    CAD: "en-CA",
    HKD: "en-HK",
    JPY: "ja-JP",
    AUD: "en-AU"
  };
  var money = (n, ccy = "USD", digits = 0) => n.toLocaleString(
    _LOCALE[ccy] || "en-US",
    { style: "currency", currency: ccy, minimumFractionDigits: digits, maximumFractionDigits: digits }
  );
  var moneyByCcy = (byCcy, digits = 0) => {
    const keys = Object.keys(byCcy || {}).filter((k) => byCcy[k] !== 0);
    if (keys.length === 0) return money(0, "USD", digits);
    return keys.sort().map((k) => money(byCcy[k], k, digits)).join(" \xB7 ");
  };
  var signUsd = (n) => `${n >= 0 ? "+" : "\u2212"}${usd(Math.abs(n))}`;
  var signMoney = (n, ccy = "USD") => `${n >= 0 ? "+" : "\u2212"}${money(Math.abs(n), ccy)}`;
  var signPct = (n, d = 2) => `${n >= 0 ? "+" : "\u2212"}${Math.abs(n).toFixed(d)}%`;
  var cls = (...xs) => xs.filter(Boolean).join(" ");
  var dirCls = (n) => n > 0 ? "up" : n < 0 ? "down" : "";
  var DAY_MS = 864e5;
  var daysAgo = (iso) => Math.floor((Date.now() - /* @__PURE__ */ new Date(iso + "T12:00:00")) / DAY_MS);
  var fmtDate = (iso) => {
    const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
    return isNaN(d) ? String(iso || "\u2014") : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var syncedAgo = (iso) => {
    if (!iso || iso === "never") return "never";
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "never";
    const secs = Math.max(0, Math.floor((Date.now() - t) / 1e3));
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    const d = new Date(t);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var isOptionSym = (sym) => /\d{4}-\d{2}-\d{2} \d+(\.\d+)?[CP]$/.test(sym || "");
  var underlyingOf = (sym) => (sym || "").trim().split(" ")[0].toUpperCase();
  var lotValue = (l) => l.shares * (l.price != null ? l.price : l.costPerShare);
  var lotCost = (l) => l.shares * l.costPerShare;
  var lotUnrl = (l) => lotValue(l) - lotCost(l);
  var _liveAccounts = {};
  var registerAccounts = (list) => {
    for (const a of list || []) if (a && a.id) _liveAccounts[a.id] = a;
  };
  var acctOf = (id) => _liveAccounts[id] || { id, name: id, short: id, type: "", taxable: true };
  var SETTINGS_KEY = "vantage.settings.v1";
  var DEFAULT_SETTINGS = {
    defaultAccount: "all",
    thresholdUsd: 200,
    thresholdPct: 3,
    taxRate: 24,
    notifPrefs: { tlh: true, wash: true, price: true, drift: true, system: true },
    // Phase V4 — live integration (ADR-013/014). Fixtures stay the fallback.
    backendUrl: "http://127.0.0.1:8641",
    miraUrl: "http://127.0.0.1:8080",
    aiBackend: "mira"
    // "mira" | "off"
  };
  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_SETTINGS, ...parsed, notifPrefs: { ...DEFAULT_SETTINGS.notifPrefs, ...parsed.notifPrefs || {} } };
      }
    } catch (e) {
    }
    return DEFAULT_SETTINGS;
  }
  function StatTile({ label, value, delta, deltaDir, note }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, label), /* @__PURE__ */ React.createElement("div", { className: "val" }, value), delta != null && /* @__PURE__ */ React.createElement("div", { className: cls("delta", deltaDir) }, delta), note && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, note));
  }
  var THEME_KEY = "vantage.theme";
  var THEME_ORDER = ["system", "dark", "light"];
  var THEME_ICON = { system: "\u25D0", dark: "\u263E", light: "\u2600" };
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.dataset.theme = t;
    else delete root.dataset.theme;
  }
  function useTheme() {
    const [theme, setTheme] = React.useState(() => {
      const t = localStorage.getItem(THEME_KEY);
      return THEME_ORDER.includes(t) ? t : "system";
    });
    const cycle = () => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
      setTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
      }
      applyTheme(next);
    };
    return [theme, cycle];
  }
  var UNDERLYINGS = ["SPX", "QQQ", "IWM"];
  function SymbolSwitcher({ value, onChange, options = UNDERLYINGS }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-symsw", role: "tablist", "aria-label": "underlying" }, options.map((s) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: s,
        role: "tab",
        "aria-selected": s === value,
        className: cls("vg-symsw-btn", s === value && "on"),
        onClick: () => onChange(s)
      },
      s
    )));
  }

  // src/live.js
  var live_exports = {};
  __export(live_exports, {
    accounts: () => accounts,
    allocation: () => allocation,
    analyzeSymbol: () => analyzeSymbol,
    closePaperTrade: () => closePaperTrade,
    createAccount: () => createAccount,
    deleteAccount: () => deleteAccount,
    deleteJournal: () => deleteJournal,
    editAccount: () => editAccount,
    ensureTodayJournal: () => ensureTodayJournal,
    getAnalysis: () => getAnalysis,
    getBars: () => getBars,
    getBarsOverlay: () => getBarsOverlay,
    getExplanation: () => getExplanation,
    getFuturesAnalysis: () => getFuturesAnalysis,
    getHistory: () => getHistory,
    getInsights: () => getInsights,
    getJournal: () => getJournal,
    getJson: () => getJson,
    getNotebook: () => getNotebook,
    getPaper: () => getPaper,
    getPlaybook: () => getPlaybook,
    getPlaybookPine: () => getPlaybookPine,
    getRoundtrips: () => getRoundtrips,
    getSignals: () => getSignals,
    getStrategies: () => getStrategies,
    getTicket: () => getTicket,
    getTradeStats: () => getTradeStats,
    health: () => health,
    importFutures: () => importFutures,
    journalImageUrl: () => journalImageUrl,
    kiteLoginUrl: () => kiteLoginUrl,
    lots: () => lots,
    mapAllocation: () => mapAllocation,
    mapAnalysis: () => mapAnalysis,
    mapAnalyze: () => mapAnalyze,
    mapBars: () => mapBars,
    mapBarsOverlay: () => mapBarsOverlay,
    mapByTicker: () => mapByTicker,
    mapDecision: () => mapDecision,
    mapFuturesAnalysis: () => mapFuturesAnalysis,
    mapHistory: () => mapHistory,
    mapInsights: () => mapInsights,
    mapMarketBand: () => mapMarketBand,
    mapNews: () => mapNews,
    mapNotebook: () => mapNotebook,
    mapPlaybook: () => mapPlaybook,
    mapPositions: () => mapPositions,
    mapSignals: () => mapSignals,
    mapStrategies: () => mapStrategies,
    mapTlh: () => mapTlh,
    mapWash: () => mapWash,
    miraHealth: () => miraHealth,
    openPaperTrade: () => openPaperTrade,
    positions: () => positions,
    postJson: () => postJson,
    postNote: () => postNote,
    postPlan: () => postPlan,
    quotes: () => quotes,
    recomputePlaybook: () => recomputePlaybook,
    refreshAccount: () => refreshAccount,
    refreshAll: () => refreshAll,
    saveJournalEntry: () => saveJournalEntry,
    scoreJournal: () => scoreJournal,
    settlePaper: () => settlePaper,
    streamTurn: () => streamTurn,
    symbolThreadId: () => symbolThreadId,
    syncAccount: () => syncAccount,
    threadId: () => threadId,
    tlh: () => tlh,
    uploadJournal: () => uploadJournal,
    useLive: () => useLive,
    wash: () => wash
  });
  async function getJson(url, { timeoutMs = 2500 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function postJson(url, body = {}, { timeoutMs = 3e4 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  var backendBase = () => (loadSettings().backendUrl || "").replace(/\/+$/, "");
  var miraBase = () => (loadSettings().miraUrl || "").replace(/\/+$/, "");
  var health = () => getJson(`${backendBase()}/api/health`);
  var accounts = () => getJson(`${backendBase()}/api/accounts`, { timeoutMs: 3e4 });
  var createAccount = (body) => postJson(`${backendBase()}/api/accounts`, body);
  var editAccount = (id, body) => postJson(`${backendBase()}/api/accounts/${encodeURIComponent(id)}/edit`, body);
  var deleteAccount = (id) => postJson(`${backendBase()}/api/accounts/${encodeURIComponent(id)}/delete`, {});
  var syncAccount = (id) => postJson(`${backendBase()}/api/accounts/${encodeURIComponent(id)}/sync`, {});
  var kiteLoginUrl = () => getJson(`${backendBase()}/api/kite/login-url`);
  var refreshAccount = (accountId) => postJson(`${backendBase()}/api/refresh`, { account: accountId });
  var refreshAll = () => postJson(`${backendBase()}/api/refresh`, {});
  var positions = (account = "all") => getJson(`${backendBase()}/api/positions?account=${encodeURIComponent(account)}`);
  var allocation = (account = "all") => getJson(`${backendBase()}/api/allocation?account=${encodeURIComponent(account)}`);
  var lots = (account = "all") => getJson(`${backendBase()}/api/lots?account=${encodeURIComponent(account)}`);
  var wash = () => getJson(`${backendBase()}/api/tax/wash`);
  var tlh = ({ thresholdUsd, thresholdPct } = {}) => {
    const q = new URLSearchParams();
    if (thresholdUsd != null) q.set("thresholdUsd", String(thresholdUsd));
    if (thresholdPct != null) q.set("thresholdPct", String(thresholdPct));
    const qs = q.toString();
    return getJson(`${backendBase()}/api/tax/tlh${qs ? `?${qs}` : ""}`);
  };
  var quotes = () => getJson(`${backendBase()}/api/quotes`);
  var getSignals = () => getJson(`${backendBase()}/api/signals`);
  var getHistory = (account = "all", limit) => {
    const q = new URLSearchParams();
    if (account && account !== "all") q.set("account", account);
    if (limit != null) q.set("limit", String(limit));
    const qs = q.toString();
    return getJson(`${backendBase()}/api/history${qs ? `?${qs}` : ""}`);
  };
  var getStrategies = (account = "all", status, by) => {
    const q = new URLSearchParams();
    if (account && account !== "all") q.set("account", account);
    if (status) q.set("status", status);
    if (by) q.set("by", by);
    const qs = q.toString();
    return getJson(`${backendBase()}/api/strategies${qs ? `?${qs}` : ""}`);
  };
  var getBars = (symbol, timeframe = "daily") => getJson(`${backendBase()}/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`);
  var getBarsOverlay = (symbol) => getJson(`${backendBase()}/api/bars/overlay?symbol=${encodeURIComponent(symbol)}`);
  var tickerBase = (sym) => `${backendBase()}/api/ticker/${encodeURIComponent(sym)}`;
  var getNotebook = (symbol) => getJson(`${tickerBase(symbol)}/notebook`);
  var postPlan = (symbol, plan) => postJson(`${tickerBase(symbol)}/plan`, plan);
  var postNote = (symbol, text) => postJson(`${tickerBase(symbol)}/note`, { text });
  var getAnalysis = (date, symbol) => {
    const q = new URLSearchParams();
    if (date) q.set("date", date);
    if (symbol) q.set("symbol", symbol);
    const qs = q.toString();
    return getJson(`${backendBase()}/api/analysis${qs ? `?${qs}` : ""}`);
  };
  var getRoundtrips = (account = "all", symbol) => {
    const q = new URLSearchParams();
    if (account && account !== "all") q.set("account", account);
    if (symbol) q.set("symbol", symbol);
    const qs = q.toString();
    return getJson(`${backendBase()}/api/ml/roundtrips${qs ? `?${qs}` : ""}`);
  };
  var getTradeStats = (account = "all", dimension) => {
    const q = new URLSearchParams();
    if (account && account !== "all") q.set("account", account);
    if (dimension) q.set("dimension", dimension);
    const qs = q.toString();
    return getJson(`${backendBase()}/api/ml/trade_stats${qs ? `?${qs}` : ""}`);
  };
  var mapLot = (l) => ({
    account: l.account,
    symbol: l.symbol,
    date: l.date,
    shares: l.shares,
    costPerShare: l.cost_per_share
  });
  var mapWashStatus = (w) => ({
    blocked: w.blocked,
    reason: w.reason,
    clearsOn: w.clears_on,
    clearsOnDate: w.clears_on_date,
    futureRisk: w.future_risk ? {
      account: w.future_risk.account,
      symbol: w.future_risk.symbol,
      dayOfMonth: w.future_risk.day_of_month,
      amount: w.future_risk.amount,
      cadence: w.future_risk.cadence
    } : null
  });
  function mapPositions(payload) {
    if (!payload || !Array.isArray(payload.positions)) return null;
    return payload.positions.map((p) => {
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
        accounts: p.accounts,
        // array; views spread it like the fixture Set
        lots: (p.lots || []).map((l) => ({ ...mapLot(l), price: perShare })),
        overlap: p.overlap || null
      };
    });
  }
  function mapWash(payload) {
    if (!payload || !payload.wash) return null;
    const out = {};
    for (const [sym, w] of Object.entries(payload.wash)) out[sym] = mapWashStatus(w);
    return out;
  }
  function mapTlh(payload) {
    if (!payload || !Array.isArray(payload.candidates)) return null;
    return payload.candidates.map((c) => ({
      lot: mapLot(c.lot),
      acct: c.account ? {
        id: c.account.id,
        name: c.account.name,
        short: c.account.short,
        type: c.account.type,
        taxable: c.account.taxable,
        lastSync: c.account.last_sync
      } : null,
      unrl: c.unrealized,
      lossPct: c.loss_pct,
      status: c.status,
      wash: c.wash ? mapWashStatus(c.wash) : void 0,
      replacement: c.replacement || null
    }));
  }
  function mapAllocation(payload) {
    if (!payload || !payload.by_class) return null;
    const byClass = {};
    for (const [k, v] of Object.entries(payload.by_class)) byClass[k] = v.value;
    return {
      byClass,
      total: payload.total,
      currency: payload.currency || "USD",
      byCurrency: payload.by_currency || { USD: payload.total }
    };
  }
  var _BAND_SYMS = [
    { sym: "SPY", label: "S&P 500" },
    { sym: "QQQ", label: "Nasdaq 100" },
    { sym: "IWM", label: "Russell 2000" },
    { sym: "VTI", label: "Total Market" }
  ];
  function mapMarketBand(payload) {
    if (!payload || !payload.quotes) return null;
    const q = payload.quotes;
    const indexes = _BAND_SYMS.filter((b) => q[b.sym] && q[b.sym].day_pct != null).map((b) => ({ sym: b.sym, label: b.label, price: q[b.sym].price, dayPct: q[b.sym].day_pct }));
    if (indexes.length === 0) return null;
    const avg = indexes.reduce((s, i) => s + i.dayPct, 0) / indexes.length;
    const up = indexes.filter((i) => i.dayPct > 0).length;
    let regime;
    if (avg > 0.35) regime = "Broad risk-on \u2014 most proxies up";
    else if (avg < -0.35) regime = "Broad risk-off \u2014 most proxies down";
    else if (up === indexes.length) regime = "Quietly higher across the board";
    else if (up === 0) regime = "Quietly lower across the board";
    else regime = "Mixed \u2014 no clear direction";
    return { indexes, avg, regime, asOf: payload.as_of, source: payload.source, stale: !!payload.stale };
  }
  var SIGNAL_STATUS = { hit_target: "hit-target", stopped: "stopped", open: "active", unquoted: "unquoted" };
  function mapSignals(payload) {
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
      grade: g.progress_grade
    }));
  }
  function mapHistory(payload) {
    if (!payload || !Array.isArray(payload.history)) return null;
    return payload.history.map((h) => ({
      account: h.account,
      brokerAccount: h.broker_account,
      date: h.date,
      kind: h.kind || "other",
      // "equity" | "option" | "other"
      symbol: h.symbol,
      description: h.description,
      side: h.side,
      // "buy" | "sell" | undefined
      qty: h.quantity,
      price: h.price,
      amount: h.amount,
      // signed: buys negative, sells positive
      state: h.state
      // "filled" | "cancelled" | "open" | ...
    }));
  }
  var mapStrategyLeg = (l) => ({
    side: l.side,
    // "buy" | "sell"
    optionType: l.option_type,
    // "call" | "put"
    strike: l.strike,
    contracts: l.contracts,
    positionType: l.position_type,
    // "long" | "short" (open legs)
    ratio: l.ratio,
    // closed legs
    expiration: l.expiration,
    // by_ticker legs carry their own expiry
    openedAt: l.opened_at,
    // by_ticker legs carry their open date
    avgPrice: l.avg_price,
    mark: l.mark,
    occSymbol: l.occ_symbol
    // for matching a leg to its leg-action
  });
  function mapByTicker(payload) {
    if (!payload || typeof payload !== "object") return null;
    const rows = payload.by_ticker;
    if (rows != null && !Array.isArray(rows)) return null;
    return {
      byTicker: (rows || []).map((s) => ({
        underlying: s.underlying,
        netCost: s.net_cost,
        // signed debit: positive = you paid
        currentValue: s.current_value,
        // may be null if a leg is unmarked
        unrealized: s.unrealized,
        // null if currentValue null
        firstOpened: s.first_opened,
        lastOpened: s.last_opened,
        legCount: s.leg_count,
        hasShort: s.has_short,
        spansExpiries: s.spans_expiries,
        // flags diagonals/calendars
        account: s.account,
        legs: (s.legs || []).map(mapStrategyLeg)
      }))
    };
  }
  function mapStrategies(payload) {
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
        netCost: s.net_cost,
        // signed debit: positive = you paid
        currentValue: s.current_value,
        // may be null if a leg is unmarked
        unrealized: s.unrealized,
        // null if currentValue null
        account: s._vantage_account,
        legs: (s.legs || []).map(mapStrategyLeg)
      })),
      closed: (closed || []).map((s) => ({
        kind: s.kind,
        name: s.name,
        structure: s.structure,
        underlying: s.underlying,
        direction: s.direction,
        // "credit" | "debit"
        price: s.price,
        multiplier: s.multiplier,
        cash: s.cash,
        // signed $ moved: buys negative
        state: s.state,
        // "filled" | "cancelled" | "rejected"
        quantity: s.quantity,
        timestamp: s.timestamp,
        orderId: s.order_id,
        account: s._vantage_account,
        legs: (s.legs || []).map(mapStrategyLeg)
      }))
    };
  }
  var barTime = (d) => String(d).slice(0, 10);
  function mapBars(payload) {
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
        volume: b.volume
      })),
      levels: {
        support: Array.isArray(lv.support) ? lv.support : [],
        resistance: Array.isArray(lv.resistance) ? lv.resistance : []
      },
      firstBar: payload.first_bar,
      lastBar: payload.last_bar,
      barCount: payload.bar_count
    };
  }
  function mapBarsOverlay(payload) {
    if (!payload || typeof payload !== "object" || !payload.symbol) return null;
    const cb = payload.cost_basis || null;
    return {
      symbol: payload.symbol,
      asOf: payload.as_of,
      currentPrice: payload.current_price,
      lastClose: payload.last_close,
      costBasis: cb ? {
        equity: cb.equity ? { shares: cb.equity.shares, avgCost: cb.equity.avg_cost } : null,
        options: cb.options ? { contracts: cb.options.contracts, avgCost: cb.options.avg_cost } : null
      } : null,
      levels: payload.levels || { daily: {}, weekly: {}, monthly: {} },
      analysis: payload.analysis ? mapDecision(payload.analysis) : null
    };
  }
  function mapNotebook(payload) {
    if (!payload || typeof payload !== "object") return null;
    const plan = payload.plan || null;
    return {
      symbol: payload.symbol,
      plan: plan ? {
        thesis: plan.thesis || "",
        target: plan.target ?? null,
        stop: plan.stop ?? null,
        notes: plan.notes || "",
        updatedAt: plan.updated_at || plan.updatedAt || null
      } : null,
      journal: Array.isArray(payload.journal) ? payload.journal.map((j) => ({
        id: j.id,
        createdAt: j.created_at || j.createdAt,
        kind: j.kind,
        payload: j.payload || {}
      })) : [],
      fundamentals: payload.fundamentals || null,
      // Phase V analyst datasets (REST now serves them; pass through as-is).
      riskReward: payload.risk_reward || null,
      growth: payload.growth || null,
      expectations: payload.expectations || null,
      relativeStrength: payload.relative_strength || null,
      news: mapNews(payload.news)
    };
  }
  function mapNews(news) {
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
        source: it.source || ""
      })),
      sentiment: {
        band: s.band || "neutral",
        score: typeof s.score === "number" ? s.score : 0,
        n: s.n_headlines ?? items.length,
        estimated: s.estimated !== false
      }
    };
  }
  function mapDecision(d) {
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
      conviction: d.conviction ? { label: d.conviction.label, score: d.conviction.score } : { label: "neutral", score: 0 },
      action: ad ? {
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
        weeksToOffset: ad.weeks_to_offset_at_est_credit
      } : null,
      evidence: {
        perTf: ev.per_tf || {},
        nearestSupport: ev.nearest_support || null,
        nearestResistance: ev.nearest_resistance || null,
        brokeSupportWithMomentum: !!ev.broke_support_with_momentum,
        atSupport: ev.at_support,
        factors: ev.factors || null
      },
      // Per-option-leg strategist actions (empty for pure equity). camelCase for
      // the SPA; matched to a rendered leg by occSymbol (or strike/expiry/type).
      legActions: Array.isArray(d.leg_actions) ? d.leg_actions.map((a) => ({
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
        rationale: a.rationale
      })) : []
    };
  }
  function mapAnalysis(payload) {
    if (!payload || !Array.isArray(payload.decisions)) return null;
    return {
      asOf: payload.date || payload.as_of,
      generatedAt: payload.generated_at,
      decisions: payload.decisions.map(mapDecision).filter(Boolean)
    };
  }
  var miraHealth = () => getJson(`${miraBase()}/health`);
  var getExplanation = (correlationId) => getJson(`${miraBase()}/explain?correlation_id=${encodeURIComponent(correlationId)}`);
  var getInsights = () => getJson(`${miraBase()}/insights?domain=advisor`);
  var _asText = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map(_asText).filter(Boolean).join(" \xB7 ");
    return String(v);
  };
  var _sourceOf = (evidence) => {
    if (!evidence) return "";
    let ev = evidence;
    if (typeof ev === "string") {
      try {
        ev = JSON.parse(ev);
      } catch {
        return ev.length > 80 ? "" : ev;
      }
    }
    const prov = ev && ev.provenance;
    if (prov && prov.source_id) {
      const id = String(prov.source_id).split("#")[1] || prov.source_id;
      return `source: ${id}`;
    }
    return "";
  };
  function mapInsights(payload) {
    if (!payload || typeof payload !== "object") return null;
    const r = payload.report || payload;
    return {
      summary: _asText(r.summary),
      confidence: _asText(r.confidence),
      observations: Array.isArray(r.observations) ? r.observations.map((o) => ({
        topic: _asText(o.topic),
        detail: _asText(o.detail),
        source: _sourceOf(o.evidence)
      })) : [],
      suggestions: Array.isArray(r.suggestions) ? r.suggestions.map(_asText).filter(Boolean) : [],
      caveats: _asText(r.caveats)
    };
  }
  var _threadId = null;
  function threadId() {
    if (!_threadId) _threadId = `vantage-${Date.now()}`;
    return _threadId;
  }
  var _symThreads = {};
  function symbolThreadId(sym) {
    const key = (sym || "").toUpperCase();
    if (!_symThreads[key]) _symThreads[key] = `vantage-${key}-${Date.now()}`;
    return _symThreads[key];
  }
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
      try {
        data = JSON.parse(raw);
      } catch (e) {
        data = { text: raw };
      }
    }
    if (typeof data !== "object" || data === null) data = { text: String(data) };
    return { ...data, kind: kind || "message" };
  }
  function streamTurn(prompt, thread, onEvent) {
    const ctrl = new AbortController();
    let terminal = false;
    const emit = (evt) => {
      if (terminal || !evt) return;
      if (evt.kind === "done" || evt.kind === "error") terminal = true;
      try {
        onEvent(evt);
      } catch (e) {
      }
    };
    (async () => {
      let res;
      try {
        res = await fetch(`${miraBase()}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, thread_id: thread }),
          signal: ctrl.signal
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
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buf.indexOf("\n\n")) !== -1) {
            emit(parseSseFrame(buf.slice(0, cut)));
            buf = buf.slice(cut + 2);
          }
        }
        emit(parseSseFrame(buf));
        emit({ kind: "done" });
      } catch (e) {
        emit({ kind: "error", code: "unreachable", message: "stream interrupted" });
      }
    })();
    return () => {
      terminal = true;
      ctrl.abort();
    };
  }
  async function analyzeSymbol(symbol, question) {
    const base = miraBase();
    if (!base) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9e4);
    try {
      const res = await fetch(`${base}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: (symbol || "").toUpperCase(), question: question || void 0 }),
        signal: ctrl.signal
      });
      if (!res.ok) return null;
      return mapAnalyze(await res.json());
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  async function getPlaybook(date, { refresh = false, symbol = "SPX" } = {}) {
    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
    if (refresh) params.push("refresh=1");
    const q = params.length ? `?${params.join("&")}` : "";
    const mira = symbol === "SPX" ? miraBase() : null;
    if (mira) {
      try {
        const res = await fetch(`${mira}/playbook${q}`, { signal: _timeout(9e4) });
        if (res.ok) {
          const p = await res.json();
          if (p && p.available) return mapPlaybook(p);
        }
      } catch (e) {
      }
    }
    const v = await getJson(`${backendBase()}/api/spx/playbook${q}`, { timeoutMs: 2e4 });
    if (v && v.available) return mapPlaybook({ ...v, narrative: null });
    return { available: false };
  }
  function _timeout(ms) {
    const c = new AbortController();
    setTimeout(() => c.abort(), ms);
    return c.signal;
  }
  async function getPlaybookPine(date, symbol = "SPX") {
    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
    const q = params.length ? `?${params.join("&")}` : "";
    const v = await getJson(`${backendBase()}/api/spx/playbook/pine${q}`, { timeoutMs: 2e4 });
    if (v && v.available) return { available: true, session: v.session, script: v.script };
    return { available: false };
  }
  async function getTicket(symbol, side, level, risk = 500) {
    const q = `symbol=${encodeURIComponent(symbol)}&side=${encodeURIComponent(side)}&level=${encodeURIComponent(level)}&risk=${encodeURIComponent(risk)}`;
    const v = await getJson(`${backendBase()}/api/ticket?${q}`, { timeoutMs: 2e4 });
    if (v && v.available) return { available: true, ticket: v.ticket, text: v.text };
    return { available: false, note: v && v.note || "ticket unavailable" };
  }
  async function recomputePlaybook(asOf, symbol = "SPX") {
    const base = backendBase();
    if (!base) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9e4);
    try {
      const body = {};
      if (asOf) body.as_of = asOf;
      if (symbol && symbol !== "SPX") body.symbol = symbol;
      const res = await fetch(`${base}/api/spx/playbook/recompute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
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
  function mapPlaybook(p) {
    if (!p || typeof p !== "object") return { available: false };
    const s = p.scaffold || {};
    return {
      available: true,
      session: p.session || s.session || null,
      narrative: p.narrative || p.draft || null,
      regime: s.regime || {},
      levelLadder: Array.isArray(s.level_ladder) ? s.level_ladder : [],
      setups: Array.isArray(s.setups) ? s.setups : [],
      // durable memory levels (respected across many sessions) + confluence zones
      // (≥2 dimensions stacking) — the LuxAlgo-style features added to the scaffold.
      durable: Array.isArray(s.durable) ? s.durable : [],
      confluence: Array.isArray(s.confluence) ? s.confluence : [],
      // the compact table carries the one-line read, volume + structure notes.
      structureNote: s.table && s.table.structure_note || "",
      volumeNote: s.table && s.table.volume_note || "",
      catalysts: s.catalysts || {},
      opex: s.opex || {},
      edges: s.edges || {},
      caveats: Array.isArray(s.caveats) ? s.caveats : [],
      missing: Array.isArray(s.missing) ? s.missing : []
    };
  }
  async function getFuturesAnalysis({ contract, alignment = true } = {}) {
    const params = [];
    if (contract) params.push(`contract=${encodeURIComponent(contract)}`);
    if (!alignment) params.push("alignment=false");
    const q = params.length ? `?${params.join("&")}` : "";
    const v = await getJson(`${backendBase()}/api/futures/analysis${q}`, { timeoutMs: 3e4 });
    return mapFuturesAnalysis(v);
  }
  async function importFutures() {
    const base = backendBase();
    if (!base) return { available: false };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6e4);
    try {
      const res = await fetch(`${base}/api/futures/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        signal: ctrl.signal
      });
      if (!res.ok) return { available: false };
      return mapFuturesAnalysis(await res.json());
    } catch (e) {
      return { available: false };
    } finally {
      clearTimeout(t);
    }
  }
  function mapFuturesAnalysis(p) {
    if (!p || typeof p !== "object" || !p.available) {
      return { available: false, note: p && p.note || null };
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
      tzNote: p.tz_note || ""
    };
  }
  async function getPaper(symbol = "SPX") {
    const q = symbol && symbol !== "SPX" ? `?symbol=${encodeURIComponent(symbol)}` : "";
    const v = await getJson(`${backendBase()}/api/paper${q}`, { timeoutMs: 3e4 });
    return v && v.available ? v : { available: false, note: v && v.note };
  }
  async function _paperPost(path, body) {
    const base = backendBase();
    if (!base) return { available: false };
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3e4);
    try {
      const res = await fetch(`${base}/api/paper/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal
      });
      if (!res.ok) return { available: false };
      return await res.json();
    } catch (e) {
      return { available: false };
    } finally {
      clearTimeout(t);
    }
  }
  var openPaperTrade = (ticket) => _paperPost("open", ticket);
  var settlePaper = (symbol = "SPX") => _paperPost("settle", { symbol });
  var closePaperTrade = (id, spyExit, symbol = "SPX") => _paperPost("close", { id, spy_exit: spyExit, symbol });
  async function getJournal(symbol = "SPX") {
    const q = symbol && symbol !== "SPX" ? `?symbol=${encodeURIComponent(symbol)}` : "";
    const v = await getJson(`${backendBase()}/api/journal${q}`, { timeoutMs: 2e4 });
    return v && v.available ? v : { available: false, note: v && v.note };
  }
  async function uploadJournal(fileOrBlob, note, forecastKind = "prior", attachTo = null, symbol = "SPX") {
    const base = backendBase();
    if (!base) return { available: false };
    const fd = new FormData();
    if (fileOrBlob) fd.append("image", fileOrBlob, fileOrBlob.name || "chart.png");
    fd.append("note", note || "");
    fd.append("forecast_kind", forecastKind);
    fd.append("symbol", symbol || "SPX");
    if (attachTo != null) fd.append("attach_to", String(attachTo));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3e4);
    try {
      const res = await fetch(`${base}/api/journal/upload`, {
        method: "POST",
        body: fd,
        signal: ctrl.signal
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
      });
      return res.ok ? await res.json() : { available: false };
    } catch (e) {
      return { available: false };
    }
  }
  var ensureTodayJournal = (symbol) => _journalPost("ensure_today", symbol ? { symbol } : {});
  var scoreJournal = () => _journalPost("score", {});
  var deleteJournal = (id) => _journalPost("delete", { id });
  var saveJournalEntry = (id, entry) => _journalPost("entry", { id, entry });
  var journalImageUrl = (id) => `${backendBase()}/api/journal/image/${id}`;
  function mapAnalyze(payload) {
    if (!payload || typeof payload !== "object") return null;
    const results = Array.isArray(payload.results) ? payload.results : [];
    return {
      query: payload.query || "",
      synthesis: typeof payload.synthesis === "string" ? payload.synthesis : "",
      facets: results.map((r) => ({
        domain: r.domain || "?",
        error: r.error || (r.answer && r.answer.status === "tool_error" ? r.answer.detail || "tool error" : null)
      })),
      correlationId: payload.correlation_id || null
    };
  }
  function useLive(fetcher, fallback, deps = [], { blankOnOutage = false } = {}) {
    const [liveData, setLiveData] = React.useState(null);
    const [outage, setOutage] = React.useState(false);
    const everLive = React.useRef(false);
    React.useEffect(() => {
      let alive = true;
      setLiveData(null);
      Promise.resolve().then(fetcher).then((d) => {
        if (!alive) return;
        if (d != null) {
          everLive.current = true;
          setLiveData(d);
          setOutage(false);
        } else if (everLive.current) {
          setOutage(true);
        }
      }).catch(() => {
        if (alive && everLive.current) setOutage(true);
      });
      return () => {
        alive = false;
      };
    }, deps);
    if (liveData != null) return { data: liveData, isLive: true, outage: false };
    const blanked = blankOnOutage && outage;
    const fb = blanked ? Array.isArray(fallback) ? [] : null : fallback;
    return { data: fb, isLive: false, outage: blanked };
  }

  // src/charts.jsx
  var { useState, useMemo, useRef, useEffect } = React;
  var { FAQItem } = window.LookeyDS;
  var TF_LIVE = [
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" }
  ];
  var MAX_LEVELS_PER_SIDE = 6;
  var cssVar = (name, fallback) => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  var hexRgb = (hex) => {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  };
  function chartTheme() {
    const up = cssVar("--vg-up", "#1F9D6B");
    const down = cssVar("--vg-down", "#D93B4E");
    const faint = cssVar("--vg-faint", "#8C95AB");
    return {
      up,
      down,
      upRgb: hexRgb(up),
      downRgb: hexRgb(down),
      ink: cssVar("--vg-ink", "#131A2A"),
      text: faint,
      faintRgb: hexRgb(faint),
      grid: cssVar("--vg-hairline", "#E3E7F0"),
      border: cssVar("--vg-rule", "#CDD4E3"),
      accent: cssVar("--vg-accent", "#B97A16"),
      // distinct identity colors for the strike / cost-basis lines (non-semantic
      // series identities — the same purples read on both grounds)
      strike: "#8b5cf6",
      cost: "#a855f7"
    };
  }
  var hasLW = () => typeof window !== "undefined" && !!(window.LightweightCharts && window.LightweightCharts.createChart);
  var CONVICTION = {
    strong: { text: "STRONG", cls: "good" },
    neutral: { text: "NEUTRAL", cls: "plain" },
    weak: { text: "WEAK", cls: "warn" },
    freefall: { text: "FREEFALL", cls: "bad" }
  };
  var REC_LABEL = {
    HOLD_AND_SELL_CALL: "HOLD & SELL CALL",
    CLOSE_AND_BOOK_LOSS: "CLOSE & BOOK LOSS",
    HOLD_WASH_BLOCKED: "HOLD \u2014 WASH BLOCKED",
    MONITOR: "MONITOR"
  };
  function ConvictionBadge({ analysis }) {
    if (!analysis) return null;
    const c = CONVICTION[analysis.conviction.label] || CONVICTION.neutral;
    const rec = REC_LABEL[analysis.recommendation] || analysis.recommendation;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", c.cls) }, c.text), /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, rec));
  }
  function badgeRationale(analysis) {
    if (!analysis) return null;
    return analysis.rationale || null;
  }
  function strikeLabel(action) {
    if (!action || action.kind !== "sell_call" || action.suggestedStrike == null) return null;
    const strike = Number(action.suggestedStrike).toFixed(2);
    const credit = action.estCredit != null ? ` ~$${Math.round(action.estCredit)}` : "";
    return `sell ${strike}C${credit}`;
  }
  function levelLine(level, isSupport, th) {
    const strength = Math.max(1, Math.min(5, Number(level.strength) || 1));
    const width = Math.max(1, Math.round(strength / 1.5));
    const base = isSupport ? th.upRgb : th.downRgb;
    const opacity = 0.35 + strength / 5 * 0.5;
    const price = Number(level.price);
    return {
      price,
      color: `rgba(${base[0]},${base[1]},${base[2]},${opacity.toFixed(2)})`,
      lineWidth: width,
      lineStyle: window.LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: `${isSupport ? "S" : "R"} ${price.toFixed(2)}`
    };
  }
  function LiveCandleChart({ symbol, setSymbol }) {
    const [tf, setTf] = useState("daily");
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleRef = useRef(null);
    const volumeRef = useRef(null);
    const priceLinesRef = useRef([]);
    const [bars, setBars] = useState(null);
    const [overlay, setOverlay] = useState(null);
    const [loading, setLoading] = useState(true);
    const [noData, setNoData] = useState(false);
    useEffect(() => {
      let alive = true;
      setLoading(true);
      setNoData(false);
      getBars(symbol, tf).then((raw) => {
        if (!alive) return;
        const mapped = mapBars(raw);
        setBars(mapped);
        setLoading(false);
        if (!mapped || !mapped.bars.length) setNoData(true);
      });
      return () => {
        alive = false;
      };
    }, [symbol, tf]);
    useEffect(() => {
      let alive = true;
      getBarsOverlay(symbol).then((raw) => {
        if (alive) setOverlay(mapBarsOverlay(raw));
      });
      return () => {
        alive = false;
      };
    }, [symbol]);
    useEffect(() => {
      const el = containerRef.current;
      if (!el || !hasLW()) return void 0;
      const LW = window.LightweightCharts;
      const th = chartTheme();
      const chart = LW.createChart(el, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: th.text, fontSize: 11 },
        grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
        rightPriceScale: { borderColor: th.border },
        timeScale: { borderColor: th.border, timeVisible: false },
        crosshair: { mode: LW.CrosshairMode.Normal }
      });
      const candle = chart.addCandlestickSeries({
        upColor: th.up,
        downColor: th.down,
        wickUpColor: th.up,
        wickDownColor: th.down,
        borderUpColor: th.up,
        borderDownColor: th.down
      });
      const volume = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        color: `rgba(${th.faintRgb.join(",")},0.4)`
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      chartRef.current = chart;
      candleRef.current = candle;
      volumeRef.current = volume;
      return () => {
        chart.remove();
        chartRef.current = candleRef.current = volumeRef.current = null;
        priceLinesRef.current = [];
      };
    }, []);
    useEffect(() => {
      const candle = candleRef.current, volume = volumeRef.current;
      if (!candle || !volume || !bars || !bars.bars.length) return;
      candle.setData(bars.bars.map((b) => ({
        time: b.time,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close
      })));
      const th = chartTheme();
      volume.setData(bars.bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? `rgba(${th.upRgb.join(",")},0.35)` : `rgba(${th.downRgb.join(",")},0.35)`
      })));
      if (chartRef.current) chartRef.current.timeScale().fitContent();
    }, [bars]);
    useEffect(() => {
      const candle = candleRef.current;
      if (!candle) return;
      for (const pl of priceLinesRef.current) {
        try {
          candle.removePriceLine(pl);
        } catch (e) {
        }
      }
      priceLinesRef.current = [];
      if (!overlay) return;
      const th = chartTheme();
      const add = (opts) => {
        priceLinesRef.current.push(candle.createPriceLine(opts));
      };
      const levels = bars && bars.levels || overlay.levels && overlay.levels[tf] || { support: [], resistance: [] };
      const topBy = (arr) => [...arr || []].sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, MAX_LEVELS_PER_SIDE);
      topBy(levels.support).forEach((lv) => add(levelLine(lv, true, th)));
      topBy(levels.resistance).forEach((lv) => add(levelLine(lv, false, th)));
      const label = strikeLabel(overlay.analysis && overlay.analysis.action);
      if (label && overlay.analysis.action.suggestedStrike != null) {
        add({
          price: Number(overlay.analysis.action.suggestedStrike),
          color: th.strike,
          lineWidth: 2,
          lineStyle: window.LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: label
        });
      }
      const cb = overlay.costBasis;
      const cost = cb && (cb.equity ? cb.equity.avgCost : cb.options ? cb.options.avgCost : null);
      if (cost != null) {
        add({
          price: Number(cost),
          color: th.cost,
          lineWidth: 1,
          lineStyle: window.LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: `cost ${Number(cost).toFixed(2)}`
        });
      }
      if (overlay.currentPrice != null) {
        add({
          price: Number(overlay.currentPrice),
          color: th.ink,
          lineWidth: 1,
          lineStyle: window.LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: "price"
        });
      }
    }, [overlay, bars, tf]);
    const analysis = overlay && overlay.analysis;
    const rationale = badgeRationale(analysis);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "AI Charts"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { margin: "4px 0 0" } }, "Live candles from your bars snapshot \xB7 S/R, strike & cost overlays \xB7 educational only")), /* @__PURE__ */ React.createElement(SymbolPills, { symbol, setSymbol })), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { padding: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 8, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 17 } }, symbol), overlay && overlay.currentPrice != null && /* @__PURE__ */ React.createElement("b", { style: { fontSize: 16 } }, usd(overlay.currentPrice, 2)), /* @__PURE__ */ React.createElement(ConvictionBadge, { analysis })), /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, TF_LIVE.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.key, className: cls("vg-pill", tf === t.key && "sel"), onClick: () => setTf(t.key) }, t.label)))), rationale && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "0 0 10px", lineHeight: 1.5 } }, rationale), /* @__PURE__ */ React.createElement("div", { className: "vg-chartwrap", style: { position: "relative" } }, /* @__PURE__ */ React.createElement("div", { ref: containerRef, style: { width: "100%", height: "100%" } }), loading && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { position: "absolute", top: 8, left: 8 } }, "loading\u2026")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginTop: 10, fontSize: 12, color: "var(--color-grey)", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "var(--vg-up)" } }), " support (by strength)"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "var(--vg-down)" } }), " resistance (by strength)"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "#8b5cf6" } }), " suggested call strike"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "#a855f7" } }), " your cost basis"))));
  }
  var NON_TICKER = /* @__PURE__ */ new Set(["CASH", "CRYPTO", "FUTURES", "SWEEP"]);
  var underlyingOf2 = (sym) => String(sym).split(" ")[0].toUpperCase();
  function useSymbolChoices() {
    const live_ = useLive(() => positions().then((p) => mapPositions(p)), null, []);
    const rawHeld = (live_.data || []).map((p) => p.symbol);
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const s of rawHeld) {
      const u = underlyingOf2(s);
      if (NON_TICKER.has(u) || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }
  function SymbolPills({ symbol, setSymbol }) {
    const choices = useSymbolChoices();
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, choices.map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: cls("vg-pill", symbol === s && "sel"), onClick: () => setSymbol(s) }, s)));
  }
  function ChartsView({ symbol, setSymbol }) {
    const [mode, setMode] = useState(hasLW() ? "probing" : "svg");
    useEffect(() => {
      if (!hasLW()) {
        setMode("svg");
        return void 0;
      }
      let alive = true;
      setMode("probing");
      getBars(symbol, "daily").then((raw) => {
        if (!alive) return;
        const mapped = mapBars(raw);
        setMode(mapped && mapped.bars.length ? "live" : "svg");
      });
      return () => {
        alive = false;
      };
    }, [symbol]);
    if (mode === "live") return /* @__PURE__ */ React.createElement(LiveCandleChart, { key: symbol, symbol, setSymbol });
    const loading = mode === "probing";
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "AI Charts \u2014 ", symbol), /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { margin: "4px 0 0" } }, loading ? "loading live candles\u2026" : "live candlestick, support/resistance, and the covered-call overlay"))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { padding: 16 } }, loading ? /* @__PURE__ */ React.createElement("div", { className: "vg-chartwrap" }) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "No bar data for ", symbol, ". Run the nightly bar snapshot (", /* @__PURE__ */ React.createElement("code", null, "python -m vantage_server.snapshot_bars --from-lots"), ") or confirm the backend URL in Settings.")));
  }
  function ChartsRail({ symbol }) {
    const analysis = useLive(() => getAnalysis().then(mapAnalysis), null, []).data;
    const decision = useMemo(() => {
      const u2 = underlyingOf2(symbol);
      return (analysis?.decisions || []).find((d) => underlyingOf2(d.symbol) === u2) || null;
    }, [analysis, symbol]);
    const positions2 = useLive(() => positions("all").then(mapPositions), [], []).data;
    const u = underlyingOf2(symbol);
    const held = (positions2 || []).filter((p) => underlyingOf2(p.symbol) === u);
    const heldShares = held.reduce((s, p) => s + (p.shares || 0), 0);
    const heldValue = held.reduce((s, p) => s + (p.value || 0), 0);
    const heldUnrl = held.reduce((s, p) => s + (p.unrl || 0), 0);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "AI read"), decision ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(ConvictionBadge, { analysis: decision }), decision.rationale && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13.5, lineHeight: 1.5, margin: "10px 0 0" } }, decision.rationale)) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "No decision journal entry for ", symbol, ". Run the nightly analysis, or confirm the backend URL in Settings.")), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Your position"), held.length > 0 ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 14 } }, /* @__PURE__ */ React.createElement("b", null, heldShares.toLocaleString("en-US", { maximumFractionDigits: 2 }), " sh \xB7 ", usd(heldValue)), /* @__PURE__ */ React.createElement("span", { className: dirCls(heldUnrl), style: { color: heldUnrl >= 0 ? "var(--vg-up)" : "var(--vg-down)", fontWeight: 600 } }, signUsd(heldUnrl))), held.flatMap((p) => (p.accounts || []).map((acc, i) => /* @__PURE__ */ React.createElement("div", { key: `${p.symbol}-${i}`, className: "vg-note", style: { marginTop: 6 } }, acctOf(acc).short, ": ", p.symbol)))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Not held in any linked account.")), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement(ChartFaq, null)));
  }
  function ChartFaq() {
    const [open, setOpen] = useState(false);
    return /* @__PURE__ */ React.createElement(FAQItem, { question: "What are the AI markers?", open, onToggle: () => setOpen(!open) }, "Blue triangles mark AI-detected accumulation/entry zones, red triangles distribution/exit pressure, and gold dots contextual notes (bias flips, TLH windows on lots you own). In this prototype both the candles and the markers are simulated \u2014 educational only, never trading advice.");
  }

  // src/notebook.jsx
  var { useState: useState2, useMemo: useMemo2, useEffect: useEffect2 } = React;
  var LEG_TONE = {
    DEFEND: "bad",
    CLOSE_LEG: "bad",
    TAKE_PROFIT: "good",
    ROLL_UP: "info",
    ROLL_DOWN: "warn",
    ROLL_OUT: "warn",
    LET_EXPIRE: "plain",
    HOLD_LEG: "plain"
  };
  var LEG_TEXT = {
    DEFEND: "DEFEND",
    CLOSE_LEG: "CLOSE",
    TAKE_PROFIT: "TAKE PROFIT",
    ROLL_UP: "ROLL UP",
    ROLL_DOWN: "ROLL DOWN",
    ROLL_OUT: "ROLL OUT",
    LET_EXPIRE: "LET EXPIRE",
    HOLD_LEG: "HOLD"
  };
  var fmtBig = (n) => {
    if (n == null) return "\u2014";
    const a = Math.abs(n);
    if (a >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return usd(n);
  };
  var fmtWhen = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var pct1 = (x) => x == null ? "\u2014" : `${(x * 100).toFixed(1)}%`;
  var pct0 = (x) => x == null ? "\u2014" : `${(x * 100).toFixed(0)}%`;
  var numOrNull = (s) => {
    const t = String(s).trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };
  function nearest(levels, price) {
    const daily = levels && levels.daily || {};
    const res = (daily.resistance || []).filter((l) => l.price > price).sort((a, b) => a.price - b.price)[0] || null;
    const sup = (daily.support || []).filter((l) => l.price < price).sort((a, b) => b.price - a.price)[0] || null;
    return { res, sup };
  }
  function NotebookPanel({ symbol, accountId = "all", refreshNonce }) {
    const sym = underlyingOf(symbol);
    const overlay = useLive(() => getBarsOverlay(sym).then(mapBarsOverlay), null, [sym, refreshNonce]).data;
    const positions2 = useLive(() => positions("all").then(mapPositions), [], [refreshNonce], { blankOnOutage: true }).data;
    const nb = useLive(() => getNotebook(sym).then(mapNotebook), null, [sym, refreshNonce]);
    const notebook = nb.data;
    const [saveNonce, setSaveNonce] = useState2(0);
    const nbReload = useLive(() => getNotebook(sym).then(mapNotebook), null, [sym, saveNonce]);
    const nbData = nbReload.data || notebook;
    const held = useMemo2(
      () => positions2.filter((p) => underlyingOf(p.symbol) === sym),
      [positions2, sym]
    );
    const shares = held.reduce((s, p) => s + (p.shares || 0), 0);
    const cost = held.reduce((s, p) => s + (p.cost || 0), 0);
    const heldAccounts = [...new Set(held.flatMap((p) => p.accounts || []))];
    const price = overlay ? overlay.currentPrice : null;
    const value = price != null && shares ? price * shares : held.reduce((s, p) => s + (p.value || 0), 0);
    const unrl = price != null && shares ? value - cost : held.reduce((s, p) => s + (p.unrl || 0), 0);
    const avgCost = shares ? cost / shares : overlay && overlay.costBasis && overlay.costBasis.equity ? overlay.costBasis.equity.avgCost : null;
    const isHeld = shares > 0 || held.length > 0;
    const f = notebookOr(nbData, "fundamentals");
    const g = notebookOr(nbData, "growth");
    const ex = notebookOr(nbData, "expectations");
    const rs = notebookOr(nbData, "relativeStrength");
    const rr = notebookOr(nbData, "riskReward");
    const news = notebookOr(nbData, "news");
    const decision = overlay ? overlay.analysis : null;
    const { res, sup } = price != null ? nearest(overlay && overlay.levels, price) : { res: null, sup: null };
    const hasLegs = decision && decision.legActions && decision.legActions.length > 0;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-notebook" }, /* @__PURE__ */ React.createElement("div", { className: "vg-nb-head" }, /* @__PURE__ */ React.createElement("div", { className: "vg-nb-headmain" }, /* @__PURE__ */ React.createElement("div", { className: "vg-nb-sym" }, sym), /* @__PURE__ */ React.createElement("div", { className: "vg-note vg-nb-subtitle" }, f && f.name ? f.name : "", isHeld && heldAccounts.length ? `${f && f.name ? " \xB7 " : ""}held in ${heldAccounts.map((id) => acctOf(id).short).join(", ")}` : isHeld ? "" : " \xB7 not held"), decision && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement(ConvictionBadge, { analysis: decision }))), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-headright" }, price != null && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-price" }, usd(price, 2)), isHeld && /* @__PURE__ */ React.createElement("div", { className: cls("vg-nb-pnl", dirCls(unrl)) }, signUsd(unrl), cost ? ` \xB7 ${signPct(unrl / cost * 100)}` : ""), price != null && overlay && overlay.lastClose != null && overlay.lastClose !== price && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "close ", usd(overlay.lastClose, 2)))), /* @__PURE__ */ React.createElement(
      AskCard,
      {
        sym,
        price,
        unrl,
        isHeld,
        decision,
        shares,
        hasLegs
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-details" }, /* @__PURE__ */ React.createElement(
      Section,
      {
        title: "Position & P&L",
        summary: isHeld ? `${shares ? shares.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "\u2014"} sh \xB7 ${usd(value)} \xB7 ${signUsd(unrl)}` : "not held"
      },
      isHeld ? /* @__PURE__ */ React.createElement("div", { className: "vg-nb-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Shares", value: shares ? shares.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "\u2014" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Avg cost", value: avgCost != null ? usd(avgCost, 2) : "\u2014" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Value", value: usd(value) }), /* @__PURE__ */ React.createElement(
        StatTile,
        {
          label: "Unrealized",
          value: signUsd(unrl),
          deltaDir: dirCls(unrl),
          delta: cost ? signPct(unrl / cost * 100) : void 0
        }
      )) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Not held in any linked account.")
    ), /* @__PURE__ */ React.createElement(
      Section,
      {
        title: "AI recommendation",
        summary: decision ? decision.recommendation : "not journaled"
      },
      decision ? /* @__PURE__ */ React.createElement(React.Fragment, null, decision.rationale && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, lineHeight: 1.5, margin: "0 0 0" } }, decision.rationale), hasLegs && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontWeight: 600, marginBottom: 6 } }, "Option legs"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, decision.legActions.map((a, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-nb-leg" }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", LEG_TONE[a.action] || "plain") }, LEG_TEXT[a.action] || a.action), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, a.side, " $", Number(a.strike).toFixed(0), (a.optionType || "")[0].toUpperCase(), " \xB7 ", a.dte, "DTE \xB7 ", a.moneyness)), a.rationale && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 3 } }, a.rationale)))))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Not in the latest decision journal. Run the nightly analysis to include ", sym, ".")
    ), /* @__PURE__ */ React.createElement(
      Section,
      {
        title: "Valuation",
        summary: f && f.pe != null ? `P/E ${f.pe.toFixed(1)}` : price != null ? "levels" : "\u2014"
      },
      price != null ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.6 } }, res ? /* @__PURE__ */ React.createElement("div", null, "Nearest resistance ", /* @__PURE__ */ React.createElement("b", null, usd(res.price, 2)), " (str ", res.strength, ") \u2014 ", signPct((res.price - price) / price * 100, 1), " away") : /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "No resistance above current price."), sup && /* @__PURE__ */ React.createElement("div", null, "Nearest support ", /* @__PURE__ */ React.createElement("b", null, usd(sup.price, 2)), " (str ", sup.strength, ") \u2014 ", signPct((sup.price - price) / price * 100, 1), " away")) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Technical levels unavailable (no bars)."),
      f && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-fund", style: { marginTop: 10 } }, f.market_cap != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Mkt cap"), " ", fmtBig(f.market_cap)), f.pe != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "P/E"), " ", f.pe.toFixed(1)), f.target_mean != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Target"), " ", usd(f.target_mean, 2), price != null && ` (${signPct((f.target_mean - price) / price * 100, 0)})`), f.week52_low != null && f.week52_high != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "52w"), " ", usd(f.week52_low, 0), "\u2013", usd(f.week52_high, 0)), f.forward_pe != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Fwd P/E"), " ", f.forward_pe.toFixed(1)), f.dividend_yield != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Yield"), " ", f.dividend_yield.toFixed(2), "%"), f.beta != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Beta"), " ", f.beta.toFixed(2))),
      g && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-fund", style: { marginTop: 10 } }, g.revenue_yoy != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Rev YoY"), " ", pct0(g.revenue_yoy)), g.gross_margin != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Gross mgn"), " ", pct0(g.gross_margin)), g.fcf_margin != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "FCF mgn"), " ", pct0(g.fcf_margin)), g.rule_of_40 != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: g.rule_of_40 >= 40 ? "vg-pos" : "vg-neg" }, "Rule of 40"), " ", g.rule_of_40.toFixed(0)), g.sbc_pct_revenue != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "SBC/rev"), " ", pct0(g.sbc_pct_revenue))),
      ex && ex.implied && ex.implied.status === "ok" && ex.implied.fcf_growth_10y != null && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, lineHeight: 1.5, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Market implies"), " ", /* @__PURE__ */ React.createElement("b", null, pct0(ex.implied.fcf_growth_10y)), " FCF growth/yr for 10y", ex.assumptions && ` (r ${pct0(ex.assumptions.discount_rate)}, term ${pct1(ex.assumptions.terminal_growth)})`, g && g.growth && g.revenue_yoy != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \u2014 vs ", pct0(g.revenue_yoy), " actual rev growth")),
      ex && ex.implied && ex.implied.status === "negative_fcf" && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginTop: 8 } }, "Implied growth undefined (negative FCF)."),
      rs && rs.idio_r_1m != null && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, lineHeight: 1.5, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "1m move"), " ", /* @__PURE__ */ React.createElement("b", { className: rs.r_1m >= 0 ? "vg-pos" : "vg-neg" }, signPct(rs.r_1m * 100, 1)), rs.beta_spy != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 \u03B2 ", rs.beta_spy.toFixed(2)), " \xB7 ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "idiosyncratic"), " ", /* @__PURE__ */ React.createElement("b", { className: rs.idio_r_1m >= 0 ? "vg-pos" : "vg-neg" }, signPct(rs.idio_r_1m * 100, 1)), rs.sector_etf && rs.sector_r_1m != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " (sector ", rs.sector_etf, " ", signPct(rs.sector_r_1m * 100, 1), ")"))
    ), /* @__PURE__ */ React.createElement(NewsSection, { news }), /* @__PURE__ */ React.createElement(
      Section,
      {
        title: "My plan",
        summary: rr && rr.rr_ratio != null ? `R:R ${rr.rr_ratio.toFixed(2)}` : nbData && nbData.plan && nbData.plan.thesis ? "set" : "empty",
        plain: true
      },
      rr && rr.status === "ok" && rr.rr_ratio != null && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, lineHeight: 1.6, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Risk/reward"), " ", /* @__PURE__ */ React.createElement("b", null, rr.rr_ratio.toFixed(2), ":1"), rr.direction === "short" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " (short)"), " \xB7 ", /* @__PURE__ */ React.createElement("span", { className: "vg-pos" }, "+", usd(rr.upside, 2)), " to target", " / ", /* @__PURE__ */ React.createElement("span", { className: "vg-neg" }, "\u2212", usd(rr.downside, 2)), " to stop", rr.upside_pct != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " (", signPct(rr.upside_pct, 0), " / ", signPct(-rr.downside_pct, 0), ")")),
      rr && (rr.status === "stop_breached" || rr.status === "target_reached") && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginBottom: 8 } }, "Plan ", rr.status === "stop_breached" ? "stop breached" : "target reached", " at current price."),
      /* @__PURE__ */ React.createElement(
        PlanCard,
        {
          sym,
          plan: nbData ? nbData.plan : null,
          price,
          onSaved: () => setSaveNonce((n) => n + 1),
          embedded: true
        }
      )
    ), /* @__PURE__ */ React.createElement(
      Section,
      {
        title: "Journal",
        summary: nbData && nbData.journal && nbData.journal.length ? `${nbData.journal.length} entr${nbData.journal.length === 1 ? "y" : "ies"}` : "empty",
        plain: true
      },
      /* @__PURE__ */ React.createElement(
        JournalCard,
        {
          sym,
          journal: nbData ? nbData.journal : [],
          onAdded: () => setSaveNonce((n) => n + 1),
          embedded: true
        }
      )
    )));
  }
  function Section({ title, summary, children, plain, open = false }) {
    return /* @__PURE__ */ React.createElement("details", { className: "vg-nb-section", open }, /* @__PURE__ */ React.createElement("summary", { className: "vg-nb-summary" }, /* @__PURE__ */ React.createElement("span", { className: "vg-nb-sumtitle" }, title), summary != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-nb-sumval" }, summary)), /* @__PURE__ */ React.createElement("div", { className: plain ? "vg-nb-secbody plain" : "vg-nb-secbody" }, children));
  }
  function NewsSection({ news }) {
    const items = news && news.items ? news.items : [];
    const band = news && news.sentiment ? news.sentiment.band : null;
    const tone = band === "positive" ? "good" : band === "negative" ? "bad" : "plain";
    return /* @__PURE__ */ React.createElement(
      Section,
      {
        title: "News",
        summary: items.length ? `${items.length}${band ? ` \xB7 ${band}` : ""}` : "none"
      },
      items.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "No recent headlines from the configured sources.") : /* @__PURE__ */ React.createElement(React.Fragment, null, band && /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginBottom: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", tone) }, band), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "headline lean (estimated, not fact)")), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-news" }, items.slice(0, 8).map((it, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-nb-newsitem" }, it.url ? /* @__PURE__ */ React.createElement("a", { href: it.url, target: "_blank", rel: "noopener noreferrer", className: "vg-nb-newstitle" }, it.title) : /* @__PURE__ */ React.createElement("span", { className: "vg-nb-newstitle" }, it.title), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, it.publisher, it.publisher && it.published ? " \xB7 " : "", fmtWhen(it.published))))))
    );
  }
  function notebookOr(nb, key) {
    return nb && nb[key] ? nb[key] : null;
  }
  function PlanCard({ sym, plan, price, onSaved, embedded }) {
    const [thesis, setThesis] = useState2("");
    const [target, setTarget] = useState2("");
    const [stop, setStop] = useState2("");
    const [notes, setNotes] = useState2("");
    const [saving, setSaving] = useState2(false);
    const [note, setNote] = useState2(null);
    useEffect2(() => {
      setThesis(plan ? plan.thesis || "" : "");
      setTarget(plan && plan.target != null ? String(plan.target) : "");
      setStop(plan && plan.stop != null ? String(plan.stop) : "");
      setNotes(plan ? plan.notes || "" : "");
      setNote(null);
    }, [sym, plan]);
    const save = async () => {
      setSaving(true);
      setNote(null);
      const res = await postPlan(sym, {
        thesis,
        notes,
        target: numOrNull(target),
        stop: numOrNull(stop)
      });
      setSaving(false);
      if (res && res.plan) {
        setNote({ tone: "ok", text: "Saved." });
        onSaved && onSaved();
      } else setNote({ tone: "warn", text: "Save failed \u2014 backend unreachable." });
    };
    const t = numOrNull(target), s = numOrNull(stop);
    return /* @__PURE__ */ React.createElement("div", { className: embedded ? "" : "vg-card" }, !embedded && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "My plan"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "vg-nb-input",
        rows: 2,
        placeholder: "Thesis \u2014 why I hold this\u2026",
        value: thesis,
        onChange: (e) => setThesis(e.target.value)
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-row2" }, /* @__PURE__ */ React.createElement("label", { className: "vg-nb-field" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Target"), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "vg-nb-input",
        inputMode: "decimal",
        placeholder: "\u2014",
        value: target,
        onChange: (e) => setTarget(e.target.value)
      }
    )), /* @__PURE__ */ React.createElement("label", { className: "vg-nb-field" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Stop"), /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "vg-nb-input",
        inputMode: "decimal",
        placeholder: "\u2014",
        value: stop,
        onChange: (e) => setStop(e.target.value)
      }
    ))), price != null && (t != null || s != null) && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, t != null && /* @__PURE__ */ React.createElement(React.Fragment, null, "target ", signPct((t - price) / price * 100, 0), " away", s != null ? " \xB7 " : ""), s != null && /* @__PURE__ */ React.createElement(React.Fragment, null, "stop ", signPct((s - price) / price * 100, 0), " away")), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "vg-nb-input",
        rows: 2,
        placeholder: "Notes / plan / reminders\u2026",
        value: notes,
        onChange: (e) => setNotes(e.target.value),
        style: { marginTop: 6 }
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginTop: 6, justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: saving, onClick: save }, saving ? "Saving\u2026" : "Save plan"), note && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { color: note.tone === "warn" ? "var(--color-grey)" : void 0 } }, note.text)));
  }
  function JournalCard({ sym, journal, onAdded, embedded }) {
    const [draft, setDraft] = useState2("");
    const [busy, setBusy] = useState2(false);
    const add = async () => {
      const text = draft.trim();
      if (!text || busy) return;
      setBusy(true);
      const res = await postNote(sym, text);
      setBusy(false);
      if (res) {
        setDraft("");
        onAdded && onAdded();
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: embedded ? "" : "vg-card" }, !embedded && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Journal"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 0 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "vg-nb-input",
        placeholder: "Add a note\u2026",
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") add();
        },
        style: { flex: 1 }
      }
    ), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy || !draft.trim(), onClick: add }, "Add")), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-journal", style: { marginTop: 8 } }, journal.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "No entries yet. Snapshots accrue nightly; add your own notes anytime."), journal.map((j) => /* @__PURE__ */ React.createElement("div", { key: j.id, className: "vg-nb-entry" }, /* @__PURE__ */ React.createElement("div", { className: "vg-nb-when" }, fmtWhen(j.createdAt)), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-body" }, j.kind === "note" ? /* @__PURE__ */ React.createElement("span", null, j.payload.text) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, j.payload.price != null ? usd(j.payload.price, 2) : "\u2014", j.payload.unrl != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 unrl ", signUsd(j.payload.unrl)), j.payload.recommendation && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", j.payload.recommendation)))))));
  }
  function framePrompt(sym, text, ctx) {
    const t = text.trim();
    const facts = [];
    if (ctx) {
      if (ctx.isHeld && ctx.shares) facts.push(`hold ${Math.round(ctx.shares)} shares`);
      else if (!ctx.isHeld) facts.push("not currently held");
      if (ctx.price != null) facts.push(`price $${Number(ctx.price).toFixed(2)}`);
      if (ctx.recommendation) facts.push(`engine recommendation ${ctx.recommendation}`);
      if (ctx.unrl != null && ctx.isHeld) facts.push(`unrealized ${ctx.unrl >= 0 ? "+" : ""}$${Math.round(ctx.unrl)}`);
    }
    const ctxLine = facts.length ? ` (my ${sym}: ${facts.join(", ")})` : "";
    return `${sym} holdings recommendation and position actions${ctxLine}. ${t}`;
  }
  function formatReply(text) {
    if (!text) return text;
    const m = /^\[[a-z_:]+\]\s*(\{[\s\S]*\})\s*$/i.exec(text.trim());
    if (!m) return text;
    let obj;
    try {
      obj = JSON.parse(m[1]);
    } catch {
      return text;
    }
    const src = obj.provenance && obj.provenance.source_id ? String(obj.provenance.source_id).split("#")[1] || obj.provenance.source_id : null;
    const parts = [];
    const sym = obj.symbol ? String(obj.symbol) : null;
    if (obj.recommendation) parts.push(`Recommendation: ${obj.recommendation}`);
    if (Array.isArray(obj.actions)) {
      if (obj.actions.length === 0 && sym) parts.push(`No open actions for ${sym} \u2014 monitoring.`);
      for (const a of obj.actions) {
        parts.push(`${a.action || a.recommendation || "action"}${a.detail ? ` \u2014 ${a.detail}` : ""}`);
      }
    }
    if (obj.wash && typeof obj.wash === "object") {
      const syms = Object.values(obj.wash);
      const blocked = syms.filter((w) => w && w.blocked).length;
      parts.push(`${blocked} of ${syms.length} symbol(s) wash-blocked${sym ? ` (checked for ${sym})` : ""}.`);
    }
    if (obj.candidates && Array.isArray(obj.candidates)) {
      parts.push(`${obj.candidates.length} tax-loss-harvest candidate(s).`);
    }
    if (obj.by_class && typeof obj.by_class === "object") {
      const a = Object.entries(obj.by_class).map(([k, v]) => `${k} ${typeof v === "number" ? v.toFixed(1) : v}%`).join(", ");
      parts.push(`Allocation: ${a}`);
    }
    if (parts.length === 0) {
      const scalars = Object.entries(obj).filter(([k, v]) => v != null && (typeof v === "string" || typeof v === "number") && k !== "as_of" && k !== "source").slice(0, 4).map(([k, v]) => `${k}: ${v}`);
      parts.push(scalars.length ? scalars.join(" \xB7 ") : "Grounded in the Vantage engine.");
    }
    return { text: parts.join("\n"), source: src, asOf: obj.as_of };
  }
  var FACET_CHIPS = [
    { key: "full", label: "Full analysis", q: "What should I do about {S}?" },
    { key: "technical", label: "Technical", q: "Give me the technical / market read on {S}." },
    { key: "fundamental", label: "Fundamental", q: "How is {S} valued fundamentally?" },
    { key: "news", label: "News", q: "What's the recent news and sentiment on {S}?" },
    { key: "options", label: "Options", q: "What should I do with my {S} options?" }
  ];
  function AskCard({ sym, price, unrl, isHeld, decision, shares, hasLegs }) {
    const [msgs, setMsgs] = useState2([]);
    const [draft, setDraft] = useState2("");
    const [busy, setBusy] = useState2(false);
    const bodyRef = React.useRef(null);
    const abortRef = React.useRef(null);
    useEffect2(() => {
      setMsgs([]);
      setDraft("");
      setBusy(false);
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
      }
    }, [sym]);
    useEffect2(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs]);
    useEffect2(() => () => {
      if (abortRef.current) abortRef.current();
    }, []);
    const patchLast = (fn) => setMsgs((m) => m.map((x, i) => i === m.length - 1 ? fn(x) : x));
    const analyze = async (text) => {
      if (!text.trim() || busy) return;
      setDraft("");
      setMsgs((m) => [...m, { who: "me", text }, { who: "ai", text: "", plan: [], pending: true, mode: "analyze" }]);
      setBusy(true);
      const res = await analyzeSymbol(sym, text);
      setBusy(false);
      if (res && res.synthesis) {
        patchLast((l) => ({
          ...l,
          text: res.synthesis,
          pending: false,
          corr: res.correlationId,
          facets: res.facets || []
        }));
      } else {
        patchLast((l) => ({ ...l, pending: false, text: "" }));
        streamTurnFallback(text);
      }
    };
    const streamTurnFallback = (text) => {
      const prompt = framePrompt(sym, text, {
        price,
        unrl,
        isHeld,
        shares,
        recommendation: decision ? decision.recommendation : null
      });
      setBusy(true);
      let gotText = false;
      abortRef.current = streamTurn(prompt, symbolThreadId(sym), (evt) => {
        if (evt.kind === "plan_step") {
          patchLast((l) => ({ ...l, plan: [...l.plan || [], evt.phase ? `${evt.step} (${evt.phase})` : String(evt.step)] }));
        } else if (evt.kind === "token") {
          gotText = true;
          patchLast((l) => ({ ...l, text: l.text + (evt.text || "") }));
        } else if (evt.kind === "done") {
          setBusy(false);
          patchLast((l) => ({ ...l, pending: false, corr: evt.correlation_id || null }));
        } else if (evt.kind === "error") {
          setBusy(false);
          patchLast((l) => gotText ? { ...l, pending: false, offline: true } : { ...l, text: "Mira is unreachable \u2014 start it to ask grounded questions about this ticker.", plan: [], pending: false, offline: true });
        }
      });
    };
    const ask = (raw) => analyze((raw != null ? raw : draft).trim());
    return /* @__PURE__ */ React.createElement("div", { className: "vg-nb-ask" }, msgs.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-nb-empty" }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "0 0 10px" } }, "Ask Mira about ", sym, isHeld ? ` \u2014 your ${shares ? `${Math.round(shares)}-share ` : ""}position` : "", price != null ? ` at ${usd(price, 2)}` : "", ". Every answer is a multi-facet read (technical \xB7 fundamental \xB7 news \xB7 position), grounded in the Vantage engine."), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-facets" }, FACET_CHIPS.filter((c) => c.key !== "options" || hasLegs).map((c) => /* @__PURE__ */ React.createElement("button", { key: c.key, className: "vg-facet-chip", onClick: () => ask(c.q.replace("{S}", sym)) }, c.label)))) : /* @__PURE__ */ React.createElement("div", { className: "vg-nb-chat", ref: bodyRef }, msgs.map((m, i) => {
      const fmt = m.who === "ai" && !m.pending && m.mode !== "analyze" ? formatReply(m.text) : null;
      const body = fmt && typeof fmt === "object" ? fmt.text : fmt || m.text;
      return /* @__PURE__ */ React.createElement("div", { key: i, className: cls("vg-msg", m.who) }, m.plan && m.plan.length > 0 && m.pending && /* @__PURE__ */ React.createElement("div", { className: "vg-msg-plan" }, m.plan.map((s, j) => /* @__PURE__ */ React.createElement("div", { key: j }, "\xB7 ", s))), m.pending && m.mode === "analyze" && /* @__PURE__ */ React.createElement("div", { className: "vg-msg-plan" }, "\xB7 fanning across technical \xB7 fundamental \xB7 news \xB7 position\u2026"), /* @__PURE__ */ React.createElement("span", { style: { whiteSpace: "pre-wrap" } }, body || (m.pending ? "\u2026" : "")), m.facets && m.facets.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-facetline" }, m.facets.map((fc, j) => /* @__PURE__ */ React.createElement("span", { key: j, className: cls("vg-facet-tag", fc.error ? "bad" : "ok") }, fc.domain))), fmt && typeof fmt === "object" && fmt.source && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, "source: ", fmt.source), m.offline && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, "offline"), m.who === "ai" && m.corr && /* @__PURE__ */ React.createElement(ExplainToggle, { corr: m.corr }));
    })), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-askbar" }, msgs.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-facets vg-nb-facets-inline" }, FACET_CHIPS.filter((c) => c.key !== "options" || hasLegs).map((c) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: c.key,
        className: "vg-facet-chip sm",
        disabled: busy,
        onClick: () => ask(c.q.replace("{S}", sym))
      },
      c.label
    ))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "vg-nb-input",
        placeholder: `Ask about ${sym}\u2026`,
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") ask();
        },
        disabled: busy,
        style: { flex: 1 }
      }
    ), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy || !draft.trim(), onClick: () => ask() }, busy ? "\u2026" : "Ask")), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, "Educational only \u2014 not financial advice.")));
  }
  function ExplainToggle({ corr }) {
    const [open, setOpen] = useState2(false);
    const [rec, setRec] = useState2(void 0);
    const toggle = () => {
      const opening = !open;
      setOpen(opening);
      if (opening && rec === void 0) {
        getExplanation(corr).then((payload) => {
          const r = payload && Array.isArray(payload.records) && payload.records.length ? payload.records[0] : null;
          setRec(r);
        });
      }
    };
    const claims = rec && Array.isArray(rec.claims) ? rec.claims : [];
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", style: { fontSize: 11.5 }, onClick: toggle }, open ? "hide sources" : "sources"), open && /* @__PURE__ */ React.createElement("div", { className: "vg-msg-explain" }, rec === void 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "loading\u2026"), rec === null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no trace available"), claims.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i }, "\xB7 ", c.statement, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", c.source_type, ":", c.source_id, ")")))));
  }

  // src/options.jsx
  var { useState: useState3, useEffect: useEffect3 } = React;
  var { SecurityCard, FAQItem: FAQItem2 } = window.LookeyDS;
  var STRAT_PAGE = 40;
  var stratLabel = (s) => s.structure || s.name || "strategy";
  var KIND_CHIP = {
    single: "SINGLE",
    vertical: "SPREAD",
    butterfly: "BUTTERFLY",
    iron_condor: "CONDOR",
    "multi-leg": "COMPLEX",
    complex: "COMPLEX"
  };
  var kindChip = (kind) => KIND_CHIP[kind] || (kind ? String(kind).toUpperCase() : "STRATEGY");
  var kindChipCls = (kind) => kind === "butterfly" || kind === "iron_condor" ? "info" : "plain";
  var shortExp = (iso) => {
    const d = /* @__PURE__ */ new Date((iso || "") + "T12:00:00");
    return isNaN(d) ? String(iso || "\u2014") : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var stratWhen = (iso) => {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return { day: iso ? String(iso) : "\u2014", time: "" };
    return {
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    };
  };
  function StrategyLeg({ leg, underlying, expiration }) {
    const n = leg.contracts != null ? leg.contracts : leg.ratio != null ? leg.ratio : 1;
    const dir = leg.side === "sell" ? "\u2212" : "+";
    const oc = leg.optionType === "put" ? "P" : "C";
    const isShort = leg.positionType === "short" || leg.side === "sell";
    const parts = [];
    if (underlying) parts.push(underlying);
    if (expiration) parts.push(shortExp(expiration));
    return /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { display: "flex", alignItems: "center", gap: 8, padding: "2px 0" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", isShort ? "bad" : "good"), style: { minWidth: 44, textAlign: "center" } }, isShort ? "short" : "long"), /* @__PURE__ */ React.createElement("span", { style: { fontVariantNumeric: "tabular-nums" } }, dir, Math.abs(n), " ", parts.join(" "), " ", leg.strike != null ? leg.strike : "?", oc), (leg.avgPrice != null || leg.mark != null) && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontVariantNumeric: "tabular-nums" } }, leg.avgPrice != null ? usd(leg.avgPrice, 2) : "\u2014", " \u2192 ", leg.mark != null ? usd(leg.mark, 2) : "\u2014"));
  }
  function TickerLeg({ leg }) {
    const n = leg.contracts != null ? leg.contracts : 1;
    const dir = leg.side === "sell" ? "\u2212" : "+";
    const oc = leg.optionType === "put" ? "P" : "C";
    const isShort = leg.positionType === "short" || leg.side === "sell";
    const opened = leg.openedAt ? shortExp(leg.openedAt) : "\u2014";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { display: "flex", alignItems: "center", gap: 8, padding: "2px 0" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", isShort ? "bad" : "good"), style: { minWidth: 44, textAlign: "center" } }, isShort ? "short" : "long"), /* @__PURE__ */ React.createElement("span", { style: { minWidth: 52, fontVariantNumeric: "tabular-nums" } }, opened), /* @__PURE__ */ React.createElement("span", { style: { fontVariantNumeric: "tabular-nums" } }, dir, Math.abs(n), " ", leg.strike != null ? leg.strike : "?", oc, " \xB7 ", leg.expiration ? shortExp(leg.expiration) : "\u2014"), (leg.avgPrice != null || leg.mark != null) && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontVariantNumeric: "tabular-nums" } }, leg.avgPrice != null ? usd(leg.avgPrice, 2) : "\u2014", " \u2192 ", leg.mark != null ? usd(leg.mark, 2) : "\u2014"));
  }
  function TickerRow({ s, expanded, onToggle }) {
    const legs = s.legs || [];
    const isDiagonal = s.spansExpiries && s.hasShort;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { onClick: onToggle, style: { cursor: "pointer" }, title: "Show legs" }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { marginRight: 6, color: "var(--color-grey)" } }, expanded ? "\u25BE" : "\u25B8"), /* @__PURE__ */ React.createElement("b", null, s.underlying || "\u2014")), /* @__PURE__ */ React.createElement("td", null, s.legCount != null ? s.legCount : legs.length, isDiagonal && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { marginLeft: 6 } }, "DIAGONAL")), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.netCost != null ? usd(s.netCost) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.currentValue != null ? usd(s.currentValue) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", s.unrealized == null ? "" : s.unrealized >= 0 ? "up" : "down") }, s.unrealized != null ? signUsd(s.unrealized) : "\u2014"), /* @__PURE__ */ React.createElement("td", null, shortExp(s.firstOpened), " \u2192 ", shortExp(s.lastOpened))), expanded && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { background: "var(--color-light)", padding: "6px 12px" } }, legs.length ? legs.map((leg, i) => /* @__PURE__ */ React.createElement(TickerLeg, { key: i, leg })) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no leg detail"))));
  }
  function OpenStrategyRow({ s, expanded, onToggle }) {
    const legs = s.legs || [];
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { onClick: onToggle, style: { cursor: "pointer" }, title: "Show legs" }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { marginRight: 6, color: "var(--color-grey)" } }, expanded ? "\u25BE" : "\u25B8"), /* @__PURE__ */ React.createElement("b", null, stratLabel(s)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", kindChipCls(s.kind)), style: { marginLeft: 6 } }, kindChip(s.kind))), /* @__PURE__ */ React.createElement("td", null, s.underlying || "\u2014"), /* @__PURE__ */ React.createElement("td", null, shortExp(s.expiration), s.dte != null && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.dte, "d")), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.netCost != null ? usd(s.netCost) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.currentValue != null ? usd(s.currentValue) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", s.unrealized == null ? "" : s.unrealized >= 0 ? "up" : "down") }, s.unrealized != null ? signUsd(s.unrealized) : "\u2014")), expanded && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { background: "var(--color-light)", padding: "6px 12px" } }, legs.length ? legs.map((leg, i) => /* @__PURE__ */ React.createElement(StrategyLeg, { key: i, leg, underlying: s.underlying, expiration: s.expiration })) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no leg detail"))));
  }
  function ClosedStrategyRow({ s, expanded, onToggle }) {
    const legs = s.legs || [];
    const w = stratWhen(s.timestamp);
    const dimmed = s.state === "cancelled";
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { onClick: onToggle, style: { cursor: "pointer", opacity: dimmed ? 0.55 : 1 }, title: "Show legs" }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { marginRight: 6, color: "var(--color-grey)" } }, expanded ? "\u25BE" : "\u25B8"), /* @__PURE__ */ React.createElement("b", null, stratLabel(s)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", kindChipCls(s.kind)), style: { marginLeft: 6 } }, kindChip(s.kind))), /* @__PURE__ */ React.createElement("td", null, s.underlying || "\u2014"), /* @__PURE__ */ React.createElement("td", null, s.direction === "credit" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "credit"), s.direction === "debit" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "debit"), s.direction !== "credit" && s.direction !== "debit" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: cls("num", s.cash == null ? "" : s.cash >= 0 ? "up" : "down") }, s.cash != null ? signUsd(s.cash) : "\u2014"), /* @__PURE__ */ React.createElement("td", null, s.state === "filled" && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5 } }, "filled"), s.state === "cancelled" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "cancelled"), s.state === "rejected" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "rejected"), s.state && !["filled", "cancelled", "rejected"].includes(s.state) && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, s.state), !s.state && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", null, w.day, w.time && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, w.time))), expanded && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { background: "var(--color-light)", padding: "6px 12px" } }, legs.length ? legs.map((leg, i) => /* @__PURE__ */ React.createElement(StrategyLeg, { key: i, leg, underlying: s.underlying })) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no leg detail"))));
  }
  function StrategiesSection({ accountId }) {
    const [tab, setTab] = useState3("open");
    const [shown, setShown] = useState3(STRAT_PAGE);
    const [open, setOpen] = useState3({});
    const strat = useLive(
      () => getStrategies(accountId).then(mapStrategies),
      null,
      [accountId]
    ).data;
    const byTickerData = useLive(
      () => getStrategies(accountId, void 0, "ticker").then(mapByTicker),
      null,
      [accountId]
    ).data;
    useEffect3(() => {
      setShown(STRAT_PAGE);
      setOpen({});
    }, [accountId, tab]);
    const openRows = strat && strat.open || [];
    const closedRows = strat && strat.closed || [];
    const tickerRows = byTickerData && byTickerData.byTicker || [];
    const hasAny = openRows.length > 0 || closedRows.length > 0 || tickerRows.length > 0;
    const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
    return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 24 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 2 } }, /* @__PURE__ */ React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, "Strategies"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "grouped option legs \xB7 net of shorts \xB7 marks live")), !hasAny ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No option strategies"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0", maxWidth: 560 } }, "Multi-leg option positions and closed spread orders arrive with a broker import \u2014 run the importer with ", /* @__PURE__ */ React.createElement("b", null, "--breakout"), " to group individual legs into strategies. There is no demo fixture, so this stays empty offline.")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px", marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { padding: "6px 4px 8px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", tab === "open" && "sel"), onClick: () => setTab("open") }, "Open", openRows.length ? ` \xB7 ${openRows.length}` : ""), /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", tab === "history" && "sel"), onClick: () => setTab("history") }, "History", closedRows.length ? ` \xB7 ${closedRows.length}` : ""), /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", tab === "ticker" && "sel"), onClick: () => setTab("ticker") }, "By ticker", tickerRows.length ? ` \xB7 ${tickerRows.length}` : ""))), tab === "ticker" ? tickerRows.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "4px" } }, "No ticker books.") : /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Ticker"), /* @__PURE__ */ React.createElement("th", null, "Legs"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Net cost"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Current"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", null, "First \u2192 last"))), /* @__PURE__ */ React.createElement("tbody", null, tickerRows.map((s, i) => /* @__PURE__ */ React.createElement(TickerRow, { key: i, s, expanded: !!open[`t${i}`], onToggle: () => toggle(`t${i}`) })))) : tab === "open" ? openRows.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "4px" } }, "No open strategies.") : /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Strategy"), /* @__PURE__ */ React.createElement("th", null, "Underlying"), /* @__PURE__ */ React.createElement("th", null, "Exp"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Net cost"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Current"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"))), /* @__PURE__ */ React.createElement("tbody", null, openRows.map((s, i) => /* @__PURE__ */ React.createElement(OpenStrategyRow, { key: i, s, expanded: !!open[`o${i}`], onToggle: () => toggle(`o${i}`) })))) : closedRows.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "4px" } }, "No closed strategies.") : /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Strategy"), /* @__PURE__ */ React.createElement("th", null, "Underlying"), /* @__PURE__ */ React.createElement("th", null, "Direction"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Net"), /* @__PURE__ */ React.createElement("th", null, "State"), /* @__PURE__ */ React.createElement("th", null, "Date"))), /* @__PURE__ */ React.createElement("tbody", null, closedRows.slice(0, shown).map((s, i) => /* @__PURE__ */ React.createElement(ClosedStrategyRow, { key: i, s, expanded: !!open[`c${i}`], onToggle: () => toggle(`c${i}`) }))))), tab === "history" && closedRows.length > shown && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setShown(shown + STRAT_PAGE) }, "Show ", Math.min(STRAT_PAGE, closedRows.length - shown), " more \xB7 ", closedRows.length - shown, " remaining"))));
  }
  function OptionsView({ accountId = "all" }) {
    const [faq, setFaq] = useState3(false);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Options"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Your live option strategies \u2014 open positions and closed spreads, rolled up by structure and ticker \xB7 educational only"), /* @__PURE__ */ React.createElement(StrategiesSection, { accountId }), /* @__PURE__ */ React.createElement("div", { className: "vg-grid2", style: { margin: "20px 0" } }, /* @__PURE__ */ React.createElement(SecurityCard, { accent: "teal", title: "Covered-call ideas live in your Actions" }, "The nightly engine flags HOLD & SELL CALL against real lots, with a suggested strike, credit, and basis reduction. Those appear in the Dashboard Action Queue \u2014 cross-checked against your Tax Center for wash risk."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "orange", title: "Approval levels differ per account" }, "Roth allows covered calls and CSPs at most brokers; 401(k)s rarely allow options at all. The engine only suggests calls on lots in accounts where they're actually executable.")), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement(FAQItem2, { question: "How are covered-call ideas generated?", open: faq, onToggle: () => setFaq(!faq) }, "The nightly analysis looks for lots of 100+ shares held at a loss or near breakeven, targets a strike above cost basis at the next monthly expiry, estimates the credit, and only recommends the call when it isn't wash-blocked. Results are persisted to the decision journal \u2014 educational only, not advice.")));
  }

  // src/glossary.jsx
  var GLOSSARY = {
    positive_gamma: {
      label: "positive gamma",
      short: "Dealers hedge AGAINST moves \u2014 they sell rallies and buy dips, which dampens the market into a range.",
      long: "Options dealers hedge to stay neutral. In POSITIVE gamma their hedging works against the move \u2014 selling into strength, buying into weakness \u2014 so it acts like a shock absorber and pins price into a range. (Negative gamma is the opposite: hedging amplifies moves, giving trend days.)"
    },
    negative_gamma: {
      label: "negative gamma",
      short: "Dealers hedge WITH the move \u2014 selling into drops, buying into rallies \u2014 so moves accelerate (trend/crash days).",
      long: "The dangerous regime: dealer hedging adds to the move (sell into declines, buy into rallies), so intraday moves get amplified. Trend days and fast selloffs live here \u2014 you go WITH the move, not against it."
    },
    mean_reversion: {
      label: "mean-reversion",
      short: "Price tends to snap back toward the middle instead of trending \u2014 so fade the edges.",
      long: "'Mean reversion' means price tends to return toward the middle of its range rather than running one direction. On a positive-gamma day the dealer hedging keeps pulling price back, so the day chops in a range \u2014 you fade the extremes (sell rallies, buy dips) instead of chasing breakouts."
    },
    fade: {
      label: "fade",
      short: "Bet AGAINST the current move \u2014 sell into a rally, buy into a dip, expecting a reversal.",
      long: "To 'fade' a move is to trade the opposite direction, expecting it to reverse. Fade a rally = sell/short as price rises into resistance. Fade a dip = buy as price falls into support. It's the core tactic on a mean-reversion (positive-gamma) day."
    },
    gamma_flip: {
      label: "gamma flip",
      short: "The price line where the regime flips: above = calm/range, below = fast/trending.",
      long: "The spot level where net dealer gamma crosses zero. Above the flip you're in the calm, range-bound (positive-gamma) regime; a break below flips it to the fast, momentum (negative-gamma) regime. It's the single most important line to watch."
    },
    call_wall: {
      label: "call wall",
      short: "The strike with the most call gamma above spot \u2014 rallies tend to stall here.",
      long: "The strike above spot with the largest dealer call-gamma. Dealer re-hedging is heaviest here, so rallies often slow or reverse at the call wall. A magnet/brake, not a guarantee."
    },
    put_wall: {
      label: "put wall",
      short: "The strike with the most put gamma below spot \u2014 dips tend to get bought here.",
      long: "The strike below spot with the largest dealer put-gamma. Dips often find support at the put wall as dealer hedging kicks in. A magnet/brake, not a guarantee."
    },
    max_pain: {
      label: "max pain",
      short: "The strike where the most options expire worthless \u2014 price often drifts toward it.",
      long: "The strike that minimizes total payout to option holders at expiry. Price sometimes drifts toward max pain into an expiration as positioning unwinds \u2014 a soft magnet, weakest of the GEX levels."
    },
    confluence: {
      label: "confluence",
      short: "A price where 2+ independent levels stack \u2014 a stronger spot than any one alone.",
      long: "A band where two or more different level types line up (e.g. a fib level + a support shelf + a wall). Stacked levels reinforce each other, so confluence zones react more reliably than a single level. Marked \u2726."
    },
    // ---- futures metrics ----
    expectancy: {
      label: "expectancy",
      short: "Your average profit/loss PER TRADE \u2014 the number that says if the system makes money.",
      long: "Win% \xD7 average win \u2212 loss% \xD7 average loss. It's what you make per trade on average. Positive = the system prints money over time even with losses; negative = it bleeds regardless of win rate. The single most important edge metric."
    },
    reward_risk: {
      label: "reward : risk",
      short: "How big your average winner is vs your average loser. Below ~1.5 means winners barely beat losers.",
      long: "Average win \xF7 average loss (in points, so a micro and a mini aren't conflated). A 54% win rate with 1.1 R:R barely pays; the same win rate at 2.0 R:R is strong. Raising your targets (or cutting losers sooner) improves this."
    },
    profit_factor: {
      label: "profit factor",
      short: "Gross profit \xF7 gross loss. Above 1 = profitable; 1.5+ is solid.",
      long: "Total dollars won \xF7 total dollars lost. 1.0 = breakeven, above 1 = profitable, 1.5+ is a healthy system. Complements expectancy \u2014 it tells you how much cushion your winners give over your losers."
    },
    drawdown: {
      label: "drawdown",
      short: "The biggest drop from a peak in your running P&L \u2014 how deep it dug before recovering.",
      long: "The largest peak-to-trough fall in your cumulative equity. It's the pain you'd have felt at the worst point. A big drawdown relative to total profit is a risk-management red flag even if you ended up green."
    },
    win_rate: {
      label: "win rate",
      short: "The % of trades that were profitable. High win rate alone doesn't mean profitable \u2014 reward:risk matters too.",
      long: "Share of round-trips that made money. On its own it's misleading: a 40%-win system with big winners beats an 80%-win system with tiny winners that gives it all back on the losers. Read it alongside reward:risk and expectancy."
    },
    reclaim: {
      label: "reclaim",
      short: "Don't enter when price TOUCHES the level \u2014 wait for 3 consecutive 5-minute closes back through it first.",
      long: "The entry discipline Vantage's backtesting program validated. Buying the instant price touches support gets stopped out by the routine overshoot ('catching a falling knife') \u2014 it lost in every regime tested, and beat the touch-entry in all 36 months of a 3-year validation. Instead, let price touch or pierce the level, then wait for THREE consecutive 5-minute candles to close back on your side of it (~15 rolling minutes of confirmation). Enter on that third close. You pay a slightly worse price and skip the days that never reclaim \u2014 those are precisely the trades that were going to lose."
    }
  };
  function Term({ k, children }) {
    const g = GLOSSARY[k];
    if (!g) return children || null;
    return /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-term",
        title: g.short,
        style: { borderBottom: "1px dotted currentColor", cursor: "help" }
      },
      children || g.label
    );
  }
  function GlossaryCard({ terms, title = "What these terms mean" }) {
    const items = (terms || []).map((k) => GLOSSARY[k]).filter(Boolean);
    if (!items.length) return null;
    return /* @__PURE__ */ React.createElement("details", { className: "vg-card" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, title), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8, marginTop: 8 } }, items.map((g, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { fontSize: 13, lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("b", null, g.label), " \u2014 ", g.long))));
  }

  // src/playbook.jsx
  var { useMemo: useMemo3, useState: useState4 } = React;
  var fmtP = (v) => v == null ? "\u2014" : Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  function levelTone(kind) {
    const k = (kind || "").toLowerCase();
    if (k.includes("resistance") || k.includes("call wall")) return "bad";
    if (k.includes("support") || k.includes("put wall")) return "good";
    if (k.includes("flip") || k.includes("pin") || k.includes("pain")) return "warn";
    return "plain";
  }
  function PlaybookView({ refreshNonce }) {
    const [nonce, setNonce] = useState4(0);
    const [sym, setSym] = useState4("SPX");
    const [pine, setPine] = useState4(null);
    const [busy, setBusy] = useState4(false);
    const [ticket, setTicket] = useState4(null);
    const [didRecompute, setDidRecompute] = useState4(false);
    const pb = useLive(
      () => getPlaybook(void 0, { refresh: didRecompute, symbol: sym }),
      null,
      [refreshNonce, nonce, sym]
    );
    const p = pb.data;
    const exportPine = async () => {
      setPine({ loading: true });
      const res = await getPlaybookPine(void 0, sym);
      setPine(res && res.available ? { script: res.script } : { error: true });
    };
    const recompute = async () => {
      if (busy) return;
      setBusy(true);
      await recomputePlaybook(void 0, sym);
      setBusy(false);
      setDidRecompute(true);
      setNonce((n) => n + 1);
    };
    const reg = p && p.regime || {};
    const cat = p && p.catalysts || {};
    const spot = reg.spot;
    const keyLevels = useMemo3(() => {
      const out = { flip: null, call: null, put: null };
      for (const r of p && p.levelLadder || []) {
        const k = (r.kind || "").toLowerCase();
        if (k.includes("flip") && out.flip == null) out.flip = r.price;
        if (k.includes("call wall") && out.call == null) out.call = r.price;
        if (k.includes("put wall") && out.put == null) out.put = r.price;
      }
      return out;
    }, [p]);
    if (p && p.available === false) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 6px", fontSize: 19 } }, "0DTE SPX Playbook"), /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "No playbook generated yet. Run ", /* @__PURE__ */ React.createElement("code", null, "python -m vantage_server.spx_playbook"), " ", "(nightly, after Sentinel's GEX/zone snapshot). It fuses dealer-gamma, S/R, breadth/VIX, Fed/macro, and SPX chart structure into a daily read."));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-playbook" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "0DTE ", sym, " Playbook"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 6, marginBottom: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement(SymbolSwitcher, { value: sym, onChange: setSym })), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, p ? `for ${p.session || "the next session"}` : "loading\u2026", reg.gamma ? ` \xB7 gamma ${reg.gamma}` : "", reg.vix != null ? ` \xB7 VIX ${fmtP(reg.vix)}${reg.vix_band ? ` (${reg.vix_band})` : ""}` : ""), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: exportPine }, "Export to Pine"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        disabled: busy,
        onClick: recompute
      },
      busy ? "Recomputing\u2026" : "Recompute"
    ))), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-levels" }, spot != null && /* @__PURE__ */ React.createElement(SummaryTile, { label: "Spot", value: fmtP(spot) }), /* @__PURE__ */ React.createElement(SummaryTile, { label: "Flip", value: fmtP(keyLevels.flip), tone: "warn" }), /* @__PURE__ */ React.createElement(SummaryTile, { label: "Put wall", value: fmtP(keyLevels.put), tone: "good" }), /* @__PURE__ */ React.createElement(SummaryTile, { label: "Call wall", value: fmtP(keyLevels.call), tone: "bad" }))), pine && /* @__PURE__ */ React.createElement(PineModal, { pine, session: p && p.session, onClose: () => setPine(null) }), ticket && /* @__PURE__ */ React.createElement(TicketModal, { sym, spot, seed: ticket, onClose: () => setTicket(null) }), cat.today && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-catalyst" }, "\u26A0\uFE0F Catalyst today: ", /* @__PURE__ */ React.createElement("b", null, cat.today), " \u2014 expect bigger moves; size down."), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today's read"), p && p.narrative ? /* @__PURE__ */ React.createElement("div", { className: "vg-pb-narrative", style: { whiteSpace: "pre-wrap" } }, p.narrative) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, pb.loading ? "Generating the read\u2026" : "No narrative available."), p && p.structureNote && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 8, fontSize: 12 } }, /* @__PURE__ */ React.createElement("b", null, "Structure:"), " ", p.structureNote), p && p.volumeNote && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 2, fontSize: 12 } }, /* @__PURE__ */ React.createElement("b", null, "Volume:"), " ", p.volumeNote)), p && reg.gamma && /* @__PURE__ */ React.createElement(PlainEnglish, { reg, keyLevels }), p && p.durable && p.durable.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Durable levels \u2605 (memory)"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, margin: "2px 0 8px" } }, 'Levels the tape kept respecting across many sessions \u2014 the "traces back weeks" levels.'), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, p.durable.map((z, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn"),
        style: { minWidth: 62, textAlign: "right" }
      },
      fmtP(z.price)
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, z.kind || `durable ${z.role}`), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, z.sessions, "\xD7 sessions", z.respected ? ` \xB7 respected ${z.respected}` : ""))))), p && p.confluence && p.confluence.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Confluence zones \u2726"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, margin: "2px 0 8px" } }, "Bands where 2+ dimensions (GEX wall / fib / PoC / S-R) line up \u2014 the high-signal levels."), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, p.confluence.map((z, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn"),
        style: { minWidth: 62, textAlign: "right" }
      },
      fmtP(z.price)
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, (z.kinds || []).slice(0, 3).join(" + ")), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, z.role, z.strength ? ` \xB7 ${z.strength} dims` : ""), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { fontSize: 11 },
        onClick: () => setTicket({ level: z.price, kind: (z.kinds || []).join(" + "), role: z.role })
      },
      "ticket"
    ))))), p && p.setups && p.setups.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Conditional setups"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 10, marginTop: 8 } }, p.setups.map((su, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-setup" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-trigger" }, "IF ", su.trigger), su.bias && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginBottom: 2 } }, su.bias), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.5 } }, su.structure))))), p && p.levelLadder && p.levelLadder.length > 0 && /* @__PURE__ */ React.createElement("details", { className: "vg-card", open: true }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, "Level ladder (", p.levelLadder.length, ")"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, p.levelLadder.map((r, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", levelTone(r.kind)), style: { minWidth: 62, textAlign: "right" } }, fmtP(r.price)), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, r.kind), r.source && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, r.source), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { fontSize: 11, marginLeft: r.source ? 0 : "auto" },
        onClick: () => setTicket({ level: r.price, kind: r.kind, role: levelTone(r.kind) === "good" ? "support" : levelTone(r.kind) === "bad" ? "resistance" : null })
      },
      "ticket"
    ))))), p && p.edges && (p.edges.gex_regime_next_day_range || p.edges.day_time) && /* @__PURE__ */ React.createElement("details", { className: "vg-card" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, "Lookback edges"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, fontSize: 13, lineHeight: 1.6 } }, p.edges.gex_regime_next_day_range && p.edges.gex_regime_next_day_range.read && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Gamma \u2192 next-day range:"), " ", p.edges.gex_regime_next_day_range.read), p.edges.day_time && p.edges.day_time.by_slot && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("b", null, "By time of day (avg 15m range):"), " ", Object.entries(p.edges.day_time.by_slot).map(([k, v]) => `${k} ${v}pt`).join(" \xB7 ")), p.edges.zone_hit_rate && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("b", null, "Zone hit-rate (Sentinel):"), " ", Math.round((p.edges.zone_hit_rate.hit_rate || 0) * 100), "% over", " ", p.edges.zone_hit_rate.tested, " tested (", p.edges.zone_hit_rate.avg_coverage_pct, "% coverage)"))), /* @__PURE__ */ React.createElement(GlossaryCard, { terms: [
      "positive_gamma",
      "negative_gamma",
      "mean_reversion",
      "fade",
      "gamma_flip",
      "call_wall",
      "put_wall",
      "max_pain",
      "confluence"
    ] }), p && p.caveats && p.caveats.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats" }, p.caveats.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i }, c)), p.missing && p.missing.length > 0 && /* @__PURE__ */ React.createElement("div", null, "Thinner read \u2014 missing sources: ", p.missing.join(", "), ".")));
  }
  function PlainEnglish({ reg, keyLevels }) {
    const pos = reg.gamma === "positive";
    const spot = reg.spot;
    const { flip, call, put } = keyLevels;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today, in plain English"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13.5, lineHeight: 1.6, marginTop: 6 } }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 8px" } }, "Dealers are in", " ", /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: pos ? "positive_gamma" : "negative_gamma" }, pos ? "positive gamma" : "negative gamma")), " ", "today", reg.vix != null ? ` (VIX ${fmtP(reg.vix)})` : "", ". ", pos ? /* @__PURE__ */ React.createElement(React.Fragment, null, "That means their hedging works like a shock absorber \u2014 selling rallies and buying dips \u2014 so this is a", " ", /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "mean_reversion" }, "mean-reversion")), " day: expect price to chop in a range rather than trend hard. The play is to", " ", /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "fade" }, "fade"), " the edges"), " \u2014 sell rallies into resistance, buy dips into support \u2014 instead of chasing breakouts.") : /* @__PURE__ */ React.createElement(React.Fragment, null, "That means their hedging ", /* @__PURE__ */ React.createElement("i", null, "amplifies"), " moves \u2014 selling into drops, buying into rallies \u2014 so moves can run. This is a momentum tape: trade", " ", /* @__PURE__ */ React.createElement("b", null, "with"), " the move, not against it, and respect breakouts.")), /* @__PURE__ */ React.createElement("p", { style: { margin: 0 } }, flip != null && spot != null && /* @__PURE__ */ React.createElement(React.Fragment, null, "Your line in the sand is the", " ", /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "gamma_flip" }, "gamma flip"), " at ", fmtP(flip)), ": while price holds above it you're in the ", pos ? "calm, range-bound" : "current", " regime; a break below flips it to the faster, trending mode. "), call != null && /* @__PURE__ */ React.createElement(React.Fragment, null, "Rallies tend to stall at the", " ", /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "call_wall" }, "call wall"), " (", fmtP(call), ")"), put != null ? /* @__PURE__ */ React.createElement(React.Fragment, null, ", and dips get bought near the", " ", /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "put_wall" }, "put wall"), " (", fmtP(put), ")")) : null, "."))));
  }
  function SummaryTile({ label, value, tone }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-tile" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11 } }, label), /* @__PURE__ */ React.createElement("div", { className: cls("vg-pb-tileval", tone) }, value));
  }
  function TicketModal({ sym, spot, seed, onClose }) {
    const defSide = seed.role === "support" ? "long" : seed.role === "resistance" ? "short" : spot != null && seed.level > spot ? "short" : "long";
    const [side, setSide] = useState4(defSide);
    const [risk, setRisk] = useState4(500);
    const [res, setRes] = useState4(null);
    const [copied, setCopied] = useState4(false);
    const stage = async () => {
      setRes({ loading: true });
      setCopied(false);
      const v = await getTicket(sym, side, seed.level, risk || 0);
      setRes(v.available ? { ticket: v.ticket, text: v.text } : { error: true, note: v.note });
    };
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(res && res.text || "");
        setCopied(true);
      } catch (e) {
        setCopied(false);
      }
    };
    const tk = res && res.ticket;
    const o = tk && tk.orders;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-modal-backdrop", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, "Stage ticket \xB7 ", sym, " ", fmtP(seed.level), seed.kind ? ` \xB7 ${seed.kind}` : ""), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: onClose }, "close")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-symsw", role: "tablist", "aria-label": "side" }, ["long", "short"].map((s) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: s,
        role: "tab",
        "aria-selected": s === side,
        className: cls("vg-symsw-btn", s === side && "on"),
        onClick: () => setSide(s)
      },
      s === "long" ? "Long (reclaim)" : "Short (fade)"
    ))), /* @__PURE__ */ React.createElement("label", { className: "vg-note", style: { fontSize: 12 } }, "risk $", /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: "1",
        step: "50",
        value: risk,
        style: { width: 70, marginLeft: 4 },
        onChange: (e) => setRisk(Number(e.target.value))
      }
    )), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        onClick: stage,
        disabled: res && res.loading
      },
      res && res.loading ? "Staging\u2026" : "Stage"
    )), res && res.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0" } }, res.note), tk && /* @__PURE__ */ React.createElement(React.Fragment, null, tk.derived_from && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0 0", fontSize: 12 } }, tk.derived_from.index, " is an index \u2014 staged in ", /* @__PURE__ */ React.createElement("b", null, tk.symbol), " at the live ratio ", tk.derived_from.ratio.toFixed(5), "."), /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { marginTop: 8, fontSize: 13 } }, /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "Entry"), /* @__PURE__ */ React.createElement("td", null, o.entry.action, " ", /* @__PURE__ */ React.createElement("b", null, o.entry.qty), " @ ", /* @__PURE__ */ React.createElement("b", null, o.entry.price), " limit")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "Stop"), /* @__PURE__ */ React.createElement("td", null, o.stop.action, " ", o.stop.qty, " @ ", /* @__PURE__ */ React.createElement("b", null, o.stop.price), " stop", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 max loss ", tk.risk.max_loss_at_stop))), o.targets.map((t) => /* @__PURE__ */ React.createElement("tr", { key: t.name }, /* @__PURE__ */ React.createElement("td", null, t.name), /* @__PURE__ */ React.createElement("td", null, o.stop.action, " ", t.qty, " @ ", /* @__PURE__ */ React.createElement("b", null, t.price), " limit", t.risk_reward != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 R:R ", t.risk_reward)))))), !tk.sized && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0" } }, "Risk budget too small for 1 share at this stop distance."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0", fontSize: 11 } }, "STAGED ONLY \u2014 review and place these in your broker. Vantage never places orders."), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: copy }, copied ? "Copied \u2713" : "Copy as text")))));
  }
  function PineModal({ pine, session, onClose }) {
    const [copied, setCopied] = useState4(false);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(pine.script || "");
        setCopied(true);
      } catch (e) {
        setCopied(false);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-modal-backdrop", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, "TradingView Pine", session ? ` \xB7 ${session}` : ""), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: onClose }, "close")), pine.loading && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0" } }, "Generating script\u2026"), pine.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0" } }, "No script \u2014 generate the playbook first (Recompute, or the nightly job)."), pine.script && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0" } }, "Copy \u2192 TradingView ", /* @__PURE__ */ React.createElement("b", null, "Pine Editor"), " \u2192 Add to chart on an ", /* @__PURE__ */ React.createElement("b", null, "SPX"), " chart. Levels & setups are baked from tonight's data; the green/red background and the arrows update live off price vs the gamma flip. ", /* @__PURE__ */ React.createElement("b", null, "Not financial advice"), " \u2014 conditional context, and the GEX read is 0DTE-blind."), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        className: "vg-pine-box",
        readOnly: true,
        value: pine.script,
        onFocus: (e) => e.target.select(),
        rows: 16
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: copy }, copied ? "Copied \u2713" : "Copy script")))));
  }

  // src/futures.jsx
  var { useState: useState5 } = React;
  var pct = (v) => v == null ? "\u2014" : `${Math.round(100 * v)}%`;
  var usd2 = (v) => v == null ? "\u2014" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  var pts = (v) => v == null ? "\u2014" : `${v > 0 ? "+" : ""}${v}pt`;
  var DIM_LABEL = {
    exit_type: "How you exited",
    hold_bucket: "How long you held",
    entry_hour_et: "Entry hour (ET)",
    playbook_align: "Vs the playbook",
    direction: "Direction",
    contract: "Contract"
  };
  var VALUE_LABEL = {
    Market: "Discretionary (market)",
    Stop: "Stop",
    StopLoss: "Stop-loss",
    Limit: "Limit (target)",
    with: "With the playbook",
    against: "Against the playbook",
    neutral: "Neutral",
    "<1m": "under 1 min",
    "1-5m": "1\u20135 min",
    "5-30m": "5\u201330 min",
    "30m+": "over 30 min",
    long: "Long",
    short: "Short"
  };
  var relabel = (v) => VALUE_LABEL[v] || v;
  function EquityCurve({ curve }) {
    if (!curve || curve.length < 2) return null;
    const W = 640, H = 130, pad = 6;
    const xs = curve.map((p) => p.cum);
    const peaks = curve.map((p) => p.peak);
    const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs);
    const range = hi - lo || 1;
    const x = (i) => pad + i / (curve.length - 1) * (W - 2 * pad);
    const y = (v) => H - pad - (v - lo) / range * (H - 2 * pad);
    const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const zeroY = y(0);
    const final = xs[xs.length - 1];
    const up = final >= 0;
    const areaCol = up ? "var(--vg-up)" : "var(--vg-down)";
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        viewBox: `0 0 ${W} ${H}`,
        width: "100%",
        height: H,
        preserveAspectRatio: "none",
        style: { display: "block" }
      },
      /* @__PURE__ */ React.createElement("line", { x1: pad, y1: zeroY, x2: W - pad, y2: zeroY, stroke: "currentColor", strokeOpacity: "0.2", strokeWidth: "1" }),
      /* @__PURE__ */ React.createElement("path", { d: line(peaks), fill: "none", stroke: "currentColor", strokeOpacity: "0.25", strokeWidth: "1", strokeDasharray: "3 3" }),
      /* @__PURE__ */ React.createElement("path", { d: line(xs), fill: "none", stroke: areaCol, strokeWidth: "1.75" })
    );
  }
  function FuturesView({ refreshNonce }) {
    const [nonce, setNonce] = useState5(0);
    const [busy, setBusy] = useState5(false);
    const fa = useLive(() => getFuturesAnalysis({ alignment: true }), null, [refreshNonce, nonce]);
    const a = fa.data;
    const reimport = async () => {
      if (busy) return;
      setBusy(true);
      await importFutures();
      setBusy(false);
      setNonce((n) => n + 1);
    };
    if (a && a.available === false) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 6px", fontSize: 19 } }, "Futures"), /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, a.note || "No AMP futures fills imported yet.", " Put the AMP CSV export in", " ", /* @__PURE__ */ React.createElement("code", null, "data/ampfutures/"), " and click Import."), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy, onClick: reimport }, busy ? "Importing\u2026" : "Import from data/ampfutures"));
    }
    const ov = a && a.overall || {};
    const rec = a && a.reconciliation || {};
    const dd = a && a.drawdown || {};
    const risk = a && a.risk || {};
    const recs = a && a.recommendations || { rules: [], coaching: [], watch: [] };
    const ob = a && a.orderBehavior || {};
    const baseline = a && a.baselineWinRate;
    const proj = a && a.projection || { available: false };
    const byDim = {};
    for (const b of a && a.buckets || []) {
      if (b.dimension === "__baseline__") continue;
      (byDim[b.dimension] = byDim[b.dimension] || []).push(b);
    }
    const DIM_ORDER = ["exit_type", "hold_bucket", "entry_hour_et", "playbook_align", "direction", "contract"];
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-playbook" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Futures performance"), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, a ? `${ov.n || 0} round-trips` : "loading\u2026", a && a.tzNote ? " \xB7 times ET" : ""), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy, onClick: reimport }, busy ? "Re-importing\u2026" : "Re-import CSVs"))), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-levels" }, /* @__PURE__ */ React.createElement(
      SummaryTile2,
      {
        termKey: "expectancy",
        label: "Expectancy / trade",
        value: usd2(ov.expectancy_usd),
        sub: pts(ov.expectancy_pts),
        tone: ov.expectancy_pts >= 0 ? "good" : "bad"
      }
    ), /* @__PURE__ */ React.createElement(
      SummaryTile2,
      {
        termKey: "reward_risk",
        label: "Reward : Risk",
        value: ov.reward_risk ?? "\u2014",
        sub: `${ov.avg_win_pts ?? "\u2014"} / ${Math.abs(ov.avg_loss_pts ?? 0)}pt`,
        tone: ov.reward_risk >= 1.5 ? "good" : "warn"
      }
    ), /* @__PURE__ */ React.createElement(SummaryTile2, { termKey: "win_rate", label: "Win rate", value: pct(ov.win_rate), tone: ov.win_rate >= 0.5 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(SummaryTile2, { termKey: "profit_factor", label: "Profit factor", value: ov.profit_factor ?? "\u2014", tone: ov.profit_factor >= 1.3 ? "good" : "warn" }), /* @__PURE__ */ React.createElement(
      SummaryTile2,
      {
        termKey: "drawdown",
        label: "Max drawdown",
        value: usd2(dd.max_drawdown),
        sub: dd.max_drawdown_pct != null ? `${dd.max_drawdown_pct}%` : "",
        tone: "bad"
      }
    ))), a && rec.reconciled === false && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-catalyst" }, "\u26A0\uFE0F ", /* @__PURE__ */ React.createElement("b", null, "Partial data:"), " ", rec.caveat), a && a.equityCurve && a.equityCurve.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Equity curve \u2014 cumulative P&L", " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "(final ", usd2(ov.total_pnl_dollars), "; dashed = running peak)")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, color: "var(--color-text, #888)" } }, /* @__PURE__ */ React.createElement(EquityCurve, { curve: a.equityCurve }))), (recs.rules.length > 0 || recs.coaching.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Recommendations to improve your win rate"), recs.rules.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, marginBottom: 4 } }, "RULES (from your numbers)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, recs.rules.map((r, i) => /* @__PURE__ */ React.createElement(RecRow, { key: i, r, icon: "\u2192" })))), recs.coaching.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, marginBottom: 4 } }, "DO MORE / DO LESS"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, recs.coaching.map((r, i) => /* @__PURE__ */ React.createElement(RecRow, { key: i, r, icon: "\u2022" }))))), risk.available && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Risk & discipline"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement(
      RiskRow,
      {
        label: "Biggest single loss",
        value: `${usd2(risk.worst_loss_usd)} (${Math.abs(risk.worst_loss_pts)}pt)`,
        note: risk.worst_vs_avg_loss ? `${risk.worst_vs_avg_loss}\xD7 a normal loser` : "",
        bad: true
      }
    ), /* @__PURE__ */ React.createElement(
      RiskRow,
      {
        label: "Worst losing streak",
        value: `${risk.worst_losing_streak} in a row`,
        note: risk.worst_losing_streak >= 4 ? "revenge-trade risk" : "",
        bad: risk.worst_losing_streak >= 4
      }
    ), /* @__PURE__ */ React.createElement(
      RiskRow,
      {
        label: "Typical hold",
        value: `${risk.median_hold_min}m`,
        note: risk.longest_loser_hold_min ? `longest loser held ${Math.round(risk.longest_loser_hold_min)}m` : ""
      }
    ))), recs.watch && recs.watch.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Next-session watch (generic NQ playbook)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 4, marginTop: 6, fontSize: 13, lineHeight: 1.5 } }, recs.watch.map((w, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: i === recs.watch.length - 1 ? "vg-note" : "" }, w.text)))), proj.available && (proj.zones || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, proj.contract, " levels \u2014 from the ", proj.etf, " 0DTE playbook (\xD7", proj.ratio, ")"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, proj.zones.sort((x, y) => (y.price || 0) - (x.price || 0)).map((z, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", z.role === "resistance" ? "bad" : z.role === "support" ? "good" : "plain"),
        style: { minWidth: 74, textAlign: "center" }
      },
      z.role
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontVariantNumeric: "tabular-nums" } }, Math.round(z.lo), "\u2013", Math.round(z.hi)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, (z.kinds || []).join(" \xB7 "))))), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, marginTop: 6, lineHeight: 1.5 } }, proj.note)), DIM_ORDER.filter((d) => byDim[d] && byDim[d].length).map((d) => /* @__PURE__ */ React.createElement("details", { key: d, className: "vg-card", open: d === "exit_type" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, DIM_LABEL[d] || d), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, byDim[d].sort((x, y) => y.n - x.n).map((b, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", b.win_rate >= (baseline || 0.5) ? "good" : "bad"),
        style: { minWidth: 46, textAlign: "center" }
      },
      pct(b.win_rate)
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, relabel(b.value)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, "n=", b.n, " \xB7 net ", usd2(b.total_pnl), b.n < 5 ? " \xB7 thin" : "")))))), ob.available && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Order behavior"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.6, marginTop: 4 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Cancel rate:"), " ", pct(ob.cancel_rate), " (", ob.cancelled, " of ", ob.total_orders, " orders)"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Filled:"), " ", ob.filled, " \xB7 ", /* @__PURE__ */ React.createElement("b", null, "Stop orders:"), " ", ob.stop_orders))), /* @__PURE__ */ React.createElement(GlossaryCard, { terms: [
      "expectancy",
      "reward_risk",
      "profit_factor",
      "drawdown",
      "win_rate"
    ] }), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats" }, /* @__PURE__ */ React.createElement("div", null, "P&L is gross of commissions (not in the AMP export). Times are ET. Reward:risk and edges use points so micro/mini aren't conflated."), /* @__PURE__ */ React.createElement("div", null, "Context for reviewing your trading, not a signal (ADR-010). Reads your CSV export; places no orders.")));
  }
  function RecRow({ r, icon }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.6, fontSize: 13 } }, icon), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.45 } }, r.text), r.evidence && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11 } }, r.evidence)));
  }
  function RiskRow({ label, value, note, bad }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, minWidth: 150 } }, label), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", bad ? "bad" : "plain"), style: { textAlign: "center" } }, value), note && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, note));
  }
  function SummaryTile2({ label, value, sub, tone, termKey }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-tile" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11 } }, termKey ? /* @__PURE__ */ React.createElement(Term, { k: termKey }, label) : label), /* @__PURE__ */ React.createElement("div", { className: cls("vg-pb-tileval", tone) }, value), sub && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 10 } }, sub));
  }

  // src/paper.jsx
  var { useState: useState6 } = React;
  var usd3 = (v) => v == null ? "\u2014" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  var pct2 = (v) => v == null ? "\u2014" : `${Math.round(100 * v)}%`;
  var px = (v) => v == null ? "\u2014" : Number(v).toFixed(2);
  var FRESH_TONE = { strong: "good", fresh: "plain", tested: "warn", weak: "bad" };
  function EquityCurve2({ curve }) {
    if (!curve || curve.length < 2) return null;
    const W = 640, H = 110, pad = 6;
    const xs = curve.map((p) => p.cum), peaks = curve.map((p) => p.peak);
    const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs), range = hi - lo || 1;
    const x = (i) => pad + i / (curve.length - 1) * (W - 2 * pad);
    const y = (v) => H - pad - (v - lo) / range * (H - 2 * pad);
    const line = (a) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const up = xs[xs.length - 1] >= 0;
    return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, preserveAspectRatio: "none", style: { display: "block" } }, /* @__PURE__ */ React.createElement("line", { x1: pad, y1: y(0), x2: W - pad, y2: y(0), stroke: "currentColor", strokeOpacity: "0.2" }), /* @__PURE__ */ React.createElement("path", { d: line(peaks), fill: "none", stroke: "currentColor", strokeOpacity: "0.25", strokeWidth: "1", strokeDasharray: "3 3" }), /* @__PURE__ */ React.createElement("path", { d: line(xs), fill: "none", stroke: up ? "var(--vg-up)" : "var(--vg-down)", strokeWidth: "1.75" }));
  }
  function PaperView({ refreshNonce }) {
    const [nonce, setNonce] = useState6(0);
    const [busy, setBusy] = useState6("");
    const [sym, setSym] = useState6("SPX");
    const pv = useLive(() => getPaper(sym), null, [refreshNonce, nonce, sym]);
    const d = pv.data;
    const reload = () => setNonce((n) => n + 1);
    const doOpen = async (t) => {
      setBusy("open");
      await openPaperTrade(t);
      setBusy("");
      reload();
    };
    const doSettle = async () => {
      setBusy("settle");
      await settlePaper(sym);
      setBusy("");
      reload();
    };
    const doClose = async (row) => {
      setBusy(`close${row.id}`);
      await closePaperTrade(row.id, row.spy_target || row.spy_entry, sym);
      setBusy("");
      reload();
    };
    if (d && d.available === false) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 6px", fontSize: 19 } }, "Paper trading"), /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, d.note || "Paper trading needs the SQLite backend + a generated playbook."));
    }
    const tickets = d && d.tickets || [];
    const open = d && d.open || [];
    const closed = d && d.closed || [];
    const stats = d && d.stats || {};
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-playbook" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Paper trading ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12, fontWeight: 400 } }, "\xB7 no money")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 6, marginBottom: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement(SymbolSwitcher, { value: sym, onChange: setSym })), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, d ? `${open.length} open \xB7 ${closed.length} closed` : "loading\u2026", d && d.session ? ` \xB7 from the ${d.session} ${sym} playbook` : ""), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm accent", disabled: busy === "settle", onClick: doSettle }, busy === "settle" ? "Checking\u2026" : "Check fills (settle)"))), stats.n > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-levels" }, /* @__PURE__ */ React.createElement(Tile, { label: "Win rate", value: pct2(stats.win_rate), tone: stats.win_rate >= 0.5 ? "good" : "bad", termKey: "win_rate" }), /* @__PURE__ */ React.createElement(Tile, { label: "Net P&L", value: usd3(stats.total_pnl), tone: stats.total_pnl >= 0 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(Tile, { label: "Profit factor", value: stats.profit_factor ?? "\u2014", tone: stats.profit_factor >= 1.3 ? "good" : "warn", termKey: "profit_factor" }), /* @__PURE__ */ React.createElement(Tile, { label: "Closed", value: stats.n }))), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, margin: "2px 0 4px" } }, "Signals from today's playbook, priced on SPY. Wait for the", " ", /* @__PURE__ */ React.createElement(Term, { k: "reclaim" }, "reclaim trigger"), " \u2014 never enter on the touch \u2014 then log the trade and it auto-closes when it hits the ", /* @__PURE__ */ React.createElement(Term, { k: "fade" }, "target or stop"), ". No real orders are ever placed."), d && d.ticket_note && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No tradeable tickets"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginTop: 6 } }, d.ticket_note)), tickets.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today's trade tickets (SPY)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8, marginTop: 8 } }, tickets.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-setup" }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", t.side === "long" ? "good" : "bad"),
        style: { minWidth: 44, textAlign: "center" }
      },
      t.side === "long" ? "BUY" : "SELL"
    ), " ", /* @__PURE__ */ React.createElement("b", null, t.signal), t.setup === "break" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { marginLeft: 6, fontSize: 10 } }, "BREAK \u2014 experts"), t.counter_trend && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad", style: { marginLeft: 6, fontSize: 10 } }, "\u26A0 counter-trend"), t.freshness && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", FRESH_TONE[t.freshness] || "plain"),
        style: { marginLeft: 6, fontSize: 10 }
      },
      t.freshness
    )), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy === "open", onClick: () => doOpen(t) }, "Paper trade")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginTop: 4 } }, "Entry ", /* @__PURE__ */ React.createElement("b", null, px(t.spy_entry)), " \xB7 target ", /* @__PURE__ */ React.createElement("b", null, px(t.spy_target)), " \xB7 stop ", /* @__PURE__ */ React.createElement("b", null, px(t.spy_stop)), t.reward_risk != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement(Term, { k: "reward_risk" }, "R:R"), " ", t.reward_risk), " \xB7 ", "~", px(t.ref_strike), " 0DTE", t.otm_strike != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ~", px(t.otm_strike), " OTM"), t.spx_level ? ` \xB7 ${t.underlying || "SPX"} ${Math.round(t.spx_level)}` : ""), t.entry_note && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, marginTop: 3 } }, /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "reclaim" }, "Trigger"), ":"), " ", t.entry_note), (t.freshness_note || t.trend_note || t.otm_note) && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, marginTop: 2, opacity: 0.85 } }, [t.trend_note, t.freshness_note, t.otm_note].filter(Boolean).join(" \xB7 ")))))), open.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Open paper trades"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, open.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", r.side === "long" ? "good" : "bad"), style: { minWidth: 44, textAlign: "center" } }, r.side === "long" ? "BUY" : "SELL"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, r.signal), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, "entry ", px(r.spy_entry), " \xB7 tgt ", px(r.spy_target), " \xB7 stop ", px(r.spy_stop)), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { marginLeft: 8 },
        disabled: busy === `close${r.id}`,
        onClick: () => doClose(r)
      },
      busy === `close${r.id}` ? "\u2026" : "close"
    ))))), closed.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Track record (", closed.length, " closed)"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, color: "var(--color-text, #888)" } }, /* @__PURE__ */ React.createElement(EquityCurve2, { curve: d.equity_curve })), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, margin: "4px 0 6px" } }, Object.entries(stats.by_exit || {}).map(([k, v]) => `${v} ${k}`).join(" \xB7 ")), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, closed.slice(0, 12).map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", (r.pnl || 0) >= 0 ? "good" : "bad"), style: { minWidth: 62, textAlign: "right" } }, usd3(r.pnl)), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, r.signal), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 11 } }, px(r.spy_entry), "\u2192", px(r.spy_exit), " \xB7 ", r.exit_reason))))), /* @__PURE__ */ React.createElement(GlossaryCard, { terms: ["reclaim", "fade", "reward_risk", "win_rate", "profit_factor"] }), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats" }, /* @__PURE__ */ React.createElement("div", null, "SPY is a proxy for SPX; P&L is on SPY shares. A simulation for learning + strategy validation."), /* @__PURE__ */ React.createElement("div", null, "Places NO real orders and touches no broker or funds (ADR-010). Not financial advice.")));
  }
  function Tile({ label, value, tone, termKey }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-tile" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11 } }, termKey ? /* @__PURE__ */ React.createElement(Term, { k: termKey }, label) : label), /* @__PURE__ */ React.createElement("div", { className: cls("vg-pb-tileval", tone) }, value));
  }

  // src/journal.jsx
  var { useState: useState7, useRef: useRef2, useEffect: useEffect4, useMemo: useMemo4 } = React;
  var pct3 = (v) => v == null ? "\u2014" : `${Math.round(100 * v)}%`;
  var VERDICT_TONE = { held: "good", broken: "bad", tested: "warn", untested: "plain" };
  var MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  var DOW = ["S", "M", "T", "W", "T", "F", "S"];
  var ENTRY_FIELDS = [
    ["action", "Action taken", "e.g. bought 7550C, sold half at 7575"],
    ["entry", "Entry", "price / time / size you got in"],
    ["exit", "Exit", "price / time you got out"],
    ["result", "Result", "P&L, win/loss, R multiple"],
    ["lesson", "Lesson", "what to repeat or avoid next time"],
    ["notes", "Notes", "anything else"]
  ];
  var dayOf = (s) => s && s.created_at ? s.created_at.slice(0, 10) : "";
  var todayISO = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  function dayTone(snap) {
    const sc = snap && snap.scorecard;
    if (!sc) return null;
    const regimeOk = sc.regime ? sc.regime.correct : null;
    const lvl = sc.level_accuracy;
    if (regimeOk === true && (lvl == null || lvl >= 0.5)) return "good";
    if (regimeOk === false || lvl != null && lvl < 0.34) return "bad";
    return "warn";
  }
  function JournalView({ refreshNonce }) {
    const [nonce, setNonce] = useState7(0);
    const [busy, setBusy] = useState7("");
    const [sym, setSym] = useState7("SPX");
    const [selDay, setSelDay] = useState7(todayISO());
    const now = /* @__PURE__ */ new Date();
    const [view, setView] = useState7({ y: now.getFullYear(), m: now.getMonth() });
    const jv = useLive(() => getJournal(sym), null, [refreshNonce, nonce, sym]);
    const d = jv.data;
    const reload = () => setNonce((n) => n + 1);
    const ensuredRef = useRef2({});
    useEffect4(() => {
      if (ensuredRef.current[sym]) return;
      ensuredRef.current[sym] = true;
      (async () => {
        await ensureTodayJournal(sym);
        reload();
      })();
    }, [sym]);
    const snaps = d && d.snapshots || [];
    const acc = d && d.accuracy || {};
    const byDay = useMemo4(() => {
      const m = {};
      for (const s of snaps) {
        const k = dayOf(s);
        if (k && !m[k]) m[k] = s;
      }
      return m;
    }, [snaps]);
    const selSnap = byDay[selDay] || null;
    const doDelete = async (id) => {
      setBusy(`del${id}`);
      await deleteJournal(id);
      setBusy("");
      reload();
    };
    const doSaveEntry = async (id, entry) => {
      setBusy(`entry${id}`);
      await saveJournalEntry(id, entry);
      setBusy("");
      reload();
    };
    const doAttach = async (fileOrBlob) => {
      if (!fileOrBlob || !selSnap) return;
      setBusy("upload");
      await uploadJournal(fileOrBlob, "", "prior", selSnap.id);
      setBusy("");
      reload();
    };
    if (d && d.available === false) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 6px", fontSize: 19 } }, "Trading journal"), /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, d.note || "Journal needs the SQLite backend + a generated playbook."));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-jr" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Trading journal", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12, fontWeight: 400 } }, " \xB7 last night's forecast vs. today \xB7 what I did")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 6, alignItems: "center" } }, /* @__PURE__ */ React.createElement(SymbolSwitcher, { value: sym, onChange: setSym }), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, d ? `${snaps.length} ${sym} day${snaps.length === 1 ? "" : "s"} journaled` : "loading\u2026"))), acc.n_scored > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-levels" }, /* @__PURE__ */ React.createElement(Tile2, { label: "Level accuracy", value: pct3(acc.avg_level_accuracy), tone: acc.avg_level_accuracy >= 0.5 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(Tile2, { label: "Regime calls right", value: pct3(acc.regime_hit_rate), tone: acc.regime_hit_rate >= 0.5 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(Tile2, { label: "Scored", value: acc.n_scored }))), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement(
      Calendar,
      {
        view,
        setView,
        byDay,
        selDay,
        onSelect: setSelDay
      }
    )), selSnap ? /* @__PURE__ */ React.createElement(
      DayDetail,
      {
        key: selSnap.id,
        s: selSnap,
        busy,
        onDelete: doDelete,
        onSaveEntry: doSaveEntry,
        onAttach: doAttach
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { padding: "4px 2px" } }, selDay === todayISO() ? d ? "Setting up today's entry \u2014 it freezes last night's forecast and scores it against today's SPX price\u2026" : "loading\u2026" : `No journal entry for ${selDay}.`), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats" }, /* @__PURE__ */ React.createElement("div", null, "Each day freezes a playbook forecast (prior session by default); scoring compares its levels to actual SPX price action over the session."), /* @__PURE__ */ React.createElement("div", null, "Journal / analysis only. Places no orders (ADR-010). Not financial advice.")));
  }
  function Calendar({ view, setView, byDay, selDay, onSelect }) {
    const { y, m } = view;
    const first = new Date(y, m, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = todayISO();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ day, iso, snap: byDay[iso] });
    }
    const step = (delta) => {
      let nm = m + delta, ny = y;
      if (nm < 0) {
        nm = 11;
        ny -= 1;
      }
      if (nm > 11) {
        nm = 0;
        ny += 1;
      }
      setView({ y: ny, m: nm });
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-cal-head" }, /* @__PURE__ */ React.createElement("div", { className: "vg-cal-title" }, MONTHS[m], " ", y), /* @__PURE__ */ React.createElement("div", { className: "vg-cal-nav" }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => step(-1), title: "previous month" }, "\u2039"), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => setView({ y: (/* @__PURE__ */ new Date()).getFullYear(), m: (/* @__PURE__ */ new Date()).getMonth() }), title: "this month" }, "Today"), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => step(1), title: "next month" }, "\u203A"))), /* @__PURE__ */ React.createElement("div", { className: "vg-cal-grid" }, DOW.map((d, i) => /* @__PURE__ */ React.createElement("div", { key: `dow${i}`, className: "vg-cal-dow" }, d)), cells.map((c, i) => {
      if (!c) return /* @__PURE__ */ React.createElement("div", { key: `e${i}`, className: "vg-cal-cell empty" });
      const tone = c.snap ? dayTone(c.snap) : null;
      const has = !!c.snap;
      return /* @__PURE__ */ React.createElement(
        "div",
        {
          key: c.iso,
          className: cls(
            "vg-cal-cell",
            has && "has",
            tone,
            c.iso === selDay && has && "sel",
            c.iso === today && "today"
          ),
          onClick: has ? () => onSelect(c.iso) : void 0,
          title: has ? `${c.iso} \u2014 ${tone || "not scored"}` : c.iso
        },
        /* @__PURE__ */ React.createElement("span", { className: "vg-cal-day" }, c.day),
        has && /* @__PURE__ */ React.createElement("span", { className: cls("vg-cal-dot", tone || "none") })
      );
    })), /* @__PURE__ */ React.createElement("div", { className: "vg-cal-legend" }, /* @__PURE__ */ React.createElement("span", { className: "lg" }, /* @__PURE__ */ React.createElement("span", { className: "vg-cal-dot good" }), " forecast held"), /* @__PURE__ */ React.createElement("span", { className: "lg" }, /* @__PURE__ */ React.createElement("span", { className: "vg-cal-dot warn" }), " mixed"), /* @__PURE__ */ React.createElement("span", { className: "lg" }, /* @__PURE__ */ React.createElement("span", { className: "vg-cal-dot bad" }), " missed"), /* @__PURE__ */ React.createElement("span", { className: "lg" }, /* @__PURE__ */ React.createElement("span", { className: "vg-cal-dot none" }), " not scored")));
  }
  function DayDetail({ s, busy, onDelete, onSaveEntry, onAttach }) {
    const [entry, setEntry] = useState7(s.entry || {});
    const [drag, setDrag] = useState7(false);
    const fileRef = useRef2(null);
    useEffect4(() => {
      setEntry(s.entry || {});
    }, [s.id, JSON.stringify(s.entry || {})]);
    const set = (k, v) => setEntry((e) => ({ ...e, [k]: v }));
    const save = async () => {
      const clean = {};
      for (const [k] of ENTRY_FIELDS) {
        const v = (entry[k] || "").trim();
        if (v) clean[k] = v;
      }
      await onSaveEntry(s.id, clean);
    };
    const dirty = useMemo4(() => {
      const cur = {};
      for (const [k] of ENTRY_FIELDS) {
        const v = (entry[k] || "").trim();
        if (v) cur[k] = v;
      }
      return JSON.stringify(cur) !== JSON.stringify(s.entry || {});
    }, [entry, s.entry]);
    const onDrop = (e) => {
      e.preventDefault();
      setDrag(false);
      const f2 = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f2 && f2.type.startsWith("image/")) onAttach(f2);
    };
    const sc = s.scorecard;
    const f = s.forecast || {};
    const dayLabel = dayOf(s);
    const kindLabel = s.forecast_kind === "live" ? "today's live forecast" : "last night's forecast";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-jr-detail" }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, dayLabel, s.session ? ` \xB7 ${s.session} playbook` : "", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 11, marginLeft: 6, fontWeight: 400 } }, "vs. ", kindLabel)), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", disabled: busy === `del${s.id}`, onClick: () => onDelete(s.id) }, busy === `del${s.id}` ? "\u2026" : "delete")), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tiles" }, /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tile" }, /* @__PURE__ */ React.createElement("h4", null, "The forecast"), f.plan ? /* @__PURE__ */ React.createElement("div", { className: "big" }, f.gamma, " gamma") : /* @__PURE__ */ React.createElement("div", { className: "big", style: { fontWeight: 400 } }, "No forecast frozen"), f.plan && /* @__PURE__ */ React.createElement("div", { className: "sub" }, f.plan), f.spot != null && /* @__PURE__ */ React.createElement("div", { className: "sub" }, "spot at forecast: ", Math.round(f.spot), f.gamma_flip != null ? ` \xB7 flip ${Math.round(f.gamma_flip)}` : "")), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tile" }, /* @__PURE__ */ React.createElement("h4", null, "Actual"), sc ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "big" }, sc.regime ? /* @__PURE__ */ React.createElement("span", { className: sc.regime.correct ? "up" : "down" }, sc.regime.correct ? "\u2713 forecast held" : "\u2717 forecast missed") : "session read"), /* @__PURE__ */ React.createElement("div", { className: "sub" }, "price ", sc.price_low, "\u2013", sc.price_high, " (last ", sc.price_last, ")", sc.regime && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", sc.regime.outcome, " (", sc.regime.moved_pct, "% move)"), sc.level_accuracy != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 levels ", pct3(sc.level_accuracy)))) : /* @__PURE__ */ React.createElement("div", { className: "sub" }, "Not scored yet \u2014 scores against today's session once bars print."))), (f.levels || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tile" }, /* @__PURE__ */ React.createElement("h4", null, "Levels \u2014 forecast vs. actual"), /* @__PURE__ */ React.createElement(LevelTable, { forecast: f, scorecard: sc })), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-lower" }, s.image_path ? /* @__PURE__ */ React.createElement("div", { className: "vg-jr-chart" }, /* @__PURE__ */ React.createElement(
      "img",
      {
        src: journalImageUrl(s.id),
        alt: "reference chart",
        onError: (e) => {
          e.target.style.display = "none";
        }
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", marginTop: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 11 } }, "reference chart \xB7 never analyzed"), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => fileRef.current && fileRef.current.click() }, "replace")), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: fileRef,
        type: "file",
        accept: "image/*",
        style: { display: "none" },
        onChange: (e) => onAttach(e.target.files && e.target.files[0])
      }
    )) : /* @__PURE__ */ React.createElement(
      "div",
      {
        className: cls("vg-jr-drop", drag && "drag"),
        onDragOver: (e) => {
          e.preventDefault();
          setDrag(true);
        },
        onDragLeave: () => setDrag(false),
        onDrop,
        onClick: () => fileRef.current && fileRef.current.click()
      },
      /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13 } }, busy === "upload" ? "Saving\u2026" : "Drop your chart here, paste (\u2318V), or click"),
      /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11, marginTop: 4 } }, "Reference only \u2014 never analyzed."),
      /* @__PURE__ */ React.createElement(
        "input",
        {
          ref: fileRef,
          type: "file",
          accept: "image/*",
          style: { display: "none" },
          onChange: (e) => onAttach(e.target.files && e.target.files[0])
        }
      )
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-form" }, /* @__PURE__ */ React.createElement("h4", null, "My journal \u2014 what I did"), ENTRY_FIELDS.map(([k, label, ph]) => /* @__PURE__ */ React.createElement("div", { key: k, className: "vg-jr-field" }, /* @__PURE__ */ React.createElement("label", null, label), k === "notes" ? /* @__PURE__ */ React.createElement(
      "textarea",
      {
        rows: 2,
        placeholder: ph,
        value: entry[k] || "",
        onChange: (e) => set(k, e.target.value)
      }
    ) : /* @__PURE__ */ React.createElement(
      "input",
      {
        placeholder: ph,
        value: entry[k] || "",
        onChange: (e) => set(k, e.target.value)
      }
    ))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, marginTop: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy === `entry${s.id}` || !dirty, onClick: save }, busy === `entry${s.id}` ? "Saving\u2026" : "Save"), dirty && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 11 } }, "unsaved changes")))));
  }
  var VERDICT_LABEL = {
    held: "held",
    broken: "broke",
    tested: "tested",
    untested: "untested"
  };
  function actualForLevel(lv, verdict, sc) {
    if (!sc) return "not scored yet";
    const p = lv.price, hi = sc.price_high, lo = sc.price_low, last = sc.price_last;
    if (p == null || hi == null) return "\u2014";
    if (verdict === "untested") {
      const gap = lv.role === "resistance" ? p - hi : lo - p;
      const g = Math.max(0, Math.round(gap));
      return g > 0 ? `price stayed ${g} pts away \u2014 never reached` : "not reached";
    }
    if (verdict === "broken") {
      return lv.role === "resistance" ? `price pushed to ${hi} and closed above (${last})` : `price fell to ${lo} and closed below (${last})`;
    }
    if (verdict === "held") {
      return lv.role === "resistance" ? `tested (high ${hi}) but capped \u2014 closed back at ${last}` : `tested (low ${lo}) but held \u2014 closed back at ${last}`;
    }
    return `price reached it (range ${lo}\u2013${hi})`;
  }
  function LevelTable({ forecast, scorecard }) {
    const verdictByKey = {};
    for (const l of scorecard && scorecard.levels || []) verdictByKey[l.key] = l.verdict;
    const rows = [...forecast.levels || []].sort((a, b) => (b.price || 0) - (a.price || 0));
    return /* @__PURE__ */ React.createElement("div", { style: { overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-lvltbl" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Level"), /* @__PURE__ */ React.createElement("th", null, "Role"), /* @__PURE__ */ React.createElement("th", null, "Forecast expectation"), /* @__PURE__ */ React.createElement("th", null, "Outcome"), /* @__PURE__ */ React.createElement("th", null, "What price did"))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((lv) => {
      const v = verdictByKey[lv.key] || (scorecard ? "untested" : null);
      const muted = v === "untested" || v == null;
      return /* @__PURE__ */ React.createElement("tr", { key: lv.key, className: muted ? "muted" : "" }, /* @__PURE__ */ React.createElement("td", { className: "lvl-price" }, /* @__PURE__ */ React.createElement("b", null, Math.round(lv.price)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 4, fontSize: 10 } }, lv.key)), /* @__PURE__ */ React.createElement("td", null, lv.role, lv.confluence ? " \u2726" : "", lv.durable ? " \u2605" : ""), /* @__PURE__ */ React.createElement("td", { className: "lvl-expect" }, lv.expect || lv.label || "\u2014"), /* @__PURE__ */ React.createElement("td", null, v ? /* @__PURE__ */ React.createElement(
        "span",
        {
          className: cls("vg-badge", VERDICT_TONE[v] || "plain"),
          style: { minWidth: 52, textAlign: "center", display: "inline-block" }
        },
        VERDICT_LABEL[v] || v
      ) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: "lvl-actual vg-note" }, actualForLevel(lv, v, scorecard)));
    }))));
  }
  function Tile2({ label, value, tone }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-tile" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11 } }, label), /* @__PURE__ */ React.createElement("div", { className: cls("vg-pb-tileval", tone) }, value));
  }

  // src/trades.jsx
  var { useMemo: useMemo5 } = React;
  var pct4 = (v) => v == null ? "\u2014" : `${Math.round(v * 100)}%`;
  var pct12 = (v) => v == null ? "\u2014" : `${(v * 100).toFixed(1)}%`;
  var num = (v, d = 2) => v == null ? "\u2014" : Number(v).toFixed(d);
  function CiBar({ ciLow, ciHigh, winRate, baseline, kind }) {
    if (ciLow == null || ciHigh == null) return null;
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const lo = clamp(ciLow) * 100;
    const hi = clamp(ciHigh) * 100;
    const wr = winRate == null ? null : clamp(winRate) * 100;
    const base = baseline == null ? null : clamp(baseline) * 100;
    const color = kind === "leak" ? "var(--vg-danger)" : "var(--vg-success-deep)";
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(
      "div",
      {
        role: "img",
        "aria-label": `Credible interval ${pct12(ciLow)} to ${pct12(ciHigh)}, baseline ${pct12(baseline)}`,
        style: { position: "relative", height: 14, background: "var(--color-light)", borderRadius: 999 }
      },
      /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        left: `${lo}%`,
        width: `${Math.max(hi - lo, 1.5)}%`,
        top: 3,
        height: 8,
        borderRadius: 999,
        background: color,
        opacity: 0.85
      } }),
      wr != null && /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        left: `${wr}%`,
        top: 1,
        width: 2,
        height: 12,
        background: color,
        transform: "translateX(-1px)"
      } }),
      base != null && /* @__PURE__ */ React.createElement("div", { title: `baseline ${pct12(baseline)}`, style: {
        position: "absolute",
        left: `${base}%`,
        top: 0,
        width: 2,
        height: 14,
        background: "var(--color-grey)",
        transform: "translateX(-1px)"
      } })
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4, fontSize: 11.5 } }, "CI ", pct12(ciLow), "\u2013", pct12(ciHigh), " \xB7 baseline ", pct12(baseline)));
  }
  function Scorecard({ summary }) {
    const s = summary || {};
    const pf = s.profit_factor;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Win rate"), /* @__PURE__ */ React.createElement("div", { className: "val" }, pct12(s.win_rate)), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.wins ?? 0, "W / ", s.losses ?? 0, "L")), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Profit factor"), /* @__PURE__ */ React.createElement("div", { className: "val" }, num(pf)), /* @__PURE__ */ React.createElement("div", { className: cls("delta", pf != null && (pf >= 1 ? "up" : "down")) }, pf == null ? "" : pf >= 1 ? "profitable" : "below breakeven")), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Avg hold"), /* @__PURE__ */ React.createElement("div", { className: "val" }, s.avg_holding_days == null ? "\u2014" : `${num(s.avg_holding_days, 1)}d`)), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Avg MFE capture"), /* @__PURE__ */ React.createElement("div", { className: "val" }, pct4(s.avg_mfe_capture)), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "share of peak move captured")), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Closed trades"), /* @__PURE__ */ React.createElement("div", { className: "val" }, s.count ?? 0), s.entry_unknown ? /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.entry_unknown, " est. entry") : null));
  }
  function NotableCards({ notable, baseline }) {
    const significant = (notable || []).filter((b) => b.significant === true);
    if (significant.length === 0) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No defensible edges yet"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0", maxWidth: 620 } }, "No condition's win-rate separates from your ", pct12(baseline), " baseline with enough trades to be credible. Differences seen so far are within noise for the current sample \u2014 more closed round-trips are needed before a real edge or leak can be claimed."));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "vg-cardgrid", style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 14,
      marginTop: 8
    } }, significant.map((b) => /* @__PURE__ */ React.createElement("div", { key: `${b.dimension}:${b.value}`, className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 14.5 } }, b.value), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", b.kind === "leak" ? "bad" : "good") }, b.kind === "leak" ? "\u25BC leak" : "\u25B2 edge")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 2 } }, b.dimension.replace(/_/g, " ")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24, fontWeight: 700 } }, pct12(b.win_rate)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-note", b.kind === "leak" ? "down" : "up") }, signPct((b.win_rate - (baseline || 0)) * 100), " vs baseline")), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "n = ", b.n, " trades"), /* @__PURE__ */ React.createElement(
      CiBar,
      {
        ciLow: b.ci_low,
        ciHigh: b.ci_high,
        winRate: b.win_rate,
        baseline,
        kind: b.kind
      }
    ))));
  }
  function ConditionTable({ buckets, baseline }) {
    const rows = (buckets || []).filter((b) => b.dimension !== "__baseline__");
    if (rows.length === 0) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { marginTop: 8, padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Condition"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "n"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Win rate"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Credible interval (90%)"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Avg P/L"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((b) => {
      const thin = b.n < 3;
      return /* @__PURE__ */ React.createElement("tr", { key: `${b.dimension}:${b.value}`, style: { opacity: thin ? 0.5 : 1 } }, /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, /* @__PURE__ */ React.createElement("b", null, b.value), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 6 } }, b.dimension.replace(/_/g, " "))), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, b.n), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, pct12(b.win_rate)), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", minWidth: 180 } }, /* @__PURE__ */ React.createElement(CiBar, { ciLow: b.ci_low, ciHigh: b.ci_high, winRate: b.win_rate, baseline })), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, b.avg_pnl == null ? "\u2014" : signUsd(b.avg_pnl)), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, thin ? /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", title: "Too few trades to be statistically defensible" }, "n too small") : null));
    }))));
  }
  function RoundtripsTable({ roundtrips, setSymbol, go }) {
    const rows = useMemo5(() => {
      const rs = [...roundtrips || []];
      rs.sort((a, b) => String(b.close_date || "").localeCompare(String(a.close_date || "")));
      return rs.slice(0, 50);
    }, [roundtrips]);
    if (rows.length === 0) return null;
    const jump = (sym) => {
      if (setSymbol && go) {
        setSymbol(sym);
        go("charts");
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { marginTop: 8, padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Symbol"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Kind"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Open \u2192 Close"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Held"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Realized $"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "%"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Result"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "MFE capture"))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((r, i) => /* @__PURE__ */ React.createElement(
      "tr",
      {
        key: `${r.symbol}:${r.close_date}:${i}`,
        className: setSymbol ? "click" : "",
        onClick: setSymbol ? () => jump(r.symbol) : void 0,
        style: setSymbol ? { cursor: "pointer" } : void 0
      },
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, /* @__PURE__ */ React.createElement("b", null, r.symbol), r.entry_unknown ? /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 6 } }, "est.") : null),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, r.kind)),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" }, className: "vg-note" }, fmtDate(r.open_date), " \u2192 ", fmtDate(r.close_date)),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, r.holding_days, "d"),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: cls("num", r.realized_pnl >= 0 ? "up" : "down") }, signUsd(r.realized_pnl)),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: cls("num", r.realized_pct >= 0 ? "up" : "down") }, signPct(r.realized_pct)),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", r.win ? "good" : "bad") }, r.win ? "\u2713 Win" : "\u2715 Loss")),
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, pct4(r.mfe_capture))
    )))));
  }
  function TradeAnalyticsView({ accountId, settings, setSymbol, go }) {
    const rt = useLive(() => getRoundtrips(accountId), null, [accountId, settings]).data;
    const ts = useLive(() => getTradeStats(accountId), null, [accountId, settings]).data;
    const summary = rt && rt.summary;
    const hasTrades = summary && summary.count > 0;
    const asOf = rt && rt.roundtrips_as_of || ts && ts.trade_stats_as_of || null;
    const baseline = ts && ts.baseline_win_rate;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Trade Analytics"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Round-trip record + statistically-defensible edges", asOf ? ` \xB7 as of ${asOf}` : "", " \xB7 educational only, not advice"))), !hasTrades ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No trade analysis available"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0", maxWidth: 620 } }, "The round-trip journal and condition stats haven't been built yet, or the backend is unreachable. Run the trade-analysis build (it also runs nightly), then confirm the backend URL in Settings."), /* @__PURE__ */ React.createElement("pre", { style: {
      background: "var(--color-light)",
      border: "1px solid var(--color-border)",
      borderRadius: 8,
      padding: "10px 12px",
      margin: "10px 0 0",
      fontSize: 12,
      lineHeight: 1.5,
      overflowX: "auto"
    } }, /* @__PURE__ */ React.createElement("code", null, "cd server\n.venv/bin/python -m vantage_server.ml.build_roundtrips --account rh-margin --broker-account <N>\n.venv/bin/python -m vantage_server.ml.build_features --account rh-margin --from-roundtrips"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(Scorecard, { summary })), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "Defensible edges & leaks"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "2px 0 0", maxWidth: 620 } }, "Only conditions whose 90% credible interval clears your ", pct12(baseline), " baseline with enough trades to matter. Anything thinner is held back below."), /* @__PURE__ */ React.createElement(NotableCards, { notable: ts && ts.notable, baseline }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "All conditions"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "2px 0 0", maxWidth: 620 } }, "Every entry condition by win-rate and credible interval. Rows with too few trades to be defensible are muted and marked \u201Cn too small\u201D \u2014 don't read them as signal."), /* @__PURE__ */ React.createElement(ConditionTable, { buckets: ts && ts.buckets, baseline }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "Recent round-trips"), /* @__PURE__ */ React.createElement(RoundtripsTable, { roundtrips: rt && rt.roundtrips, setSymbol, go })));
  }

  // src/app.jsx
  var { useState: useState8, useMemo: useMemo6, useEffect: useEffect5, useRef: useRef3 } = React;
  var { Navbar, Button, Modal, FormField, SecurityCard: SecurityCard2, FAQItem: FAQItem3 } = window.LookeyDS;
  var EMPTY_ALLOC = { byClass: { usEquity: 0, intlEquity: 0, bonds: 0, cash: 0 }, total: 0 };
  var NAV = [
    { group: "Portfolio", items: [
      { id: "dashboard", label: "Dashboard", icon: "\u25EB" },
      { id: "holdings", label: "Positions", icon: "\u25A4" },
      { id: "tax", label: "Tax", icon: "\u{1F33E}" }
    ] },
    { group: "Intelligence", items: [
      { id: "options", label: "Options", icon: "\u25CE" },
      { id: "playbook", label: "0DTE Playbook", icon: "\u{1F3AF}" },
      { id: "paper", label: "Paper Trading", icon: "\u{1F4DD}" },
      { id: "journal", label: "Trading Journal", icon: "\u{1F4D3}" },
      { id: "futures", label: "Futures", icon: "\u{1F4C9}" },
      { id: "trades", label: "Performance", icon: "\u{1F9EE}" }
    ] }
  ];
  var DRILLDOWN_ROUTES = ["charts", "activity", "recs", "markets"];
  var ROUTES = [...NAV.flatMap((g) => g.items.map((i) => i.id)), ...DRILLDOWN_ROUTES];
  function useHashRoute() {
    const initial = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      return ROUTES.includes(h) ? h : "dashboard";
    };
    const [route, setRoute] = useState8(initial);
    useEffect5(() => {
      const onHash = () => setRoute(initial());
      window.addEventListener("hashchange", onHash);
      return () => window.removeEventListener("hashchange", onHash);
    }, []);
    const go = (r) => {
      window.location.hash = `/${r}`;
      const center = document.getElementById("vg-center");
      if (center) center.scrollTo({ top: 0 });
    };
    return [route, go];
  }
  function App() {
    const [settings, setSettings] = useState8(loadSettings);
    const [accountId, setAccountId] = useState8(settings.defaultAccount);
    const [symbol, setSymbol] = useState8("SPY");
    const [route, go] = useHashRoute();
    const [notifs, setNotifs] = useState8([]);
    const [notifOpen, setNotifOpen] = useState8(false);
    const [chatOpen, setChatOpen] = useState8(false);
    const [settingsOpen, setSettingsOpen] = useState8(false);
    const [leftOpen, setLeftOpen] = useState8(() => window.innerWidth >= 860);
    const [rightOpen, setRightOpen] = useState8(() => window.innerWidth >= 1100);
    const RIGHT_MIN = 300, RIGHT_MAX = 720;
    const [rightWidth, setRightWidth] = useState8(() => {
      const saved = Number(localStorage.getItem("vantage.rightWidth"));
      return saved >= RIGHT_MIN && saved <= RIGHT_MAX ? saved : 360;
    });
    const [resizing, setResizing] = useState8(false);
    const startResize = (e) => {
      e.preventDefault();
      setResizing(true);
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (ev) => {
        const next = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, startW + (startX - ev.clientX)));
        setRightWidth(next);
      };
      const onUp = () => {
        setResizing(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        try {
          localStorage.setItem("vantage.rightWidth", String(rightWidthRef.current));
        } catch (_) {
        }
      };
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
    const rightWidthRef = useRef3(rightWidth);
    rightWidthRef.current = rightWidth;
    const [refreshNonce, setRefreshNonce] = useState8(0);
    const [refreshing, setRefreshing] = useState8({});
    const [refreshNote, setRefreshNote] = useState8(null);
    useEffect5(() => {
      if (!window.matchMedia) return void 0;
      const mqRight = window.matchMedia("(max-width: 1099px)");
      const mqLeft = window.matchMedia("(max-width: 859px)");
      if (!mqRight.addEventListener) return void 0;
      const onRight = (e) => {
        if (e.matches) setRightOpen(false);
      };
      const onLeft = (e) => {
        if (e.matches) setLeftOpen(false);
      };
      mqRight.addEventListener("change", onRight);
      mqLeft.addEventListener("change", onLeft);
      return () => {
        mqRight.removeEventListener("change", onRight);
        mqLeft.removeEventListener("change", onLeft);
      };
    }, []);
    const tlh2 = useLive(() => tlh(settings).then(mapTlh), [], [settings], { blankOnOutage: true }).data;
    const scopeLive = useLive(
      () => accounts().then((p) => {
        if (!p || !p.accounts) return null;
        registerAccounts(p.accounts);
        return p.accounts.map((a) => ({
          id: a.id,
          short: a.short,
          type: a.type,
          value: a.value,
          currency: a.currency || "USD",
          lastSynced: a.last_synced,
          broker: a.broker,
          refreshable: a.refreshable
        }));
      }),
      [],
      [settings, refreshNonce],
      // re-fetch the rail after a refresh completes
      { blankOnOutage: true }
    );
    const scopeAccounts = scopeLive.data;
    const marketBand = useLive(() => quotes().then(mapMarketBand), null, [settings, refreshNonce]).data;
    const scopeOutage = scopeLive.outage;
    const unread = notifs.filter((n) => !n.read && settings.notifPrefs[n.type]).length;
    const summarizeRefresh = (payload) => {
      if (!payload || !payload.results) {
        return { tone: "warn", text: "Refresh failed \u2014 backend unreachable." };
      }
      const parts = [];
      let anyError = false;
      for (const r of payload.results) {
        if (r.errors && r.errors.length) {
          anyError = true;
          parts.push(`${r.account}: ${r.errors[0]}`);
          continue;
        }
        if (r.csv_only) {
          parts.push(`${r.account}: ${r.message}`);
          continue;
        }
        const label = r.broker ? r.broker[0].toUpperCase() + r.broker.slice(1) : r.account;
        parts.push(`${label}: ${r.positions} positions, ${r.new_transactions} new transactions`);
      }
      return { tone: anyError ? "warn" : "ok", text: parts.join(" \xB7 ") || "Nothing to refresh." };
    };
    const runRefresh = async (key, fetcher) => {
      setRefreshing((s) => ({ ...s, [key]: true }));
      setRefreshNote(null);
      const payload = await fetcher();
      setRefreshing((s) => {
        const n = { ...s };
        delete n[key];
        return n;
      });
      setRefreshNote(summarizeRefresh(payload));
      if (payload && payload.results) setRefreshNonce((n) => n + 1);
    };
    const onRefreshAccount = (id) => runRefresh(id, () => refreshAccount(id));
    const onRefreshAll = () => runRefresh("all", () => refreshAll());
    const saveSettings = (next) => {
      setSettings(next);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (e) {
      }
    };
    const viewProps = { accountId, setAccountId, symbol, setSymbol, settings, tlh: tlh2, go, setNotifOpen, refreshNonce };
    const dashProps = { scopeAccounts, scopeOutage, refreshing, refreshNote, onRefreshAccount, onRefreshAll };
    const hasChartRail = route === "charts";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-app" }, /* @__PURE__ */ React.createElement("div", { className: "vg-compliance" }, "AI-generated analysis \xB7 Educational purposes only \u2014 not financial, investment, or tax advice"), /* @__PURE__ */ React.createElement("div", { className: "vg-topbar" }, /* @__PURE__ */ React.createElement("div", { className: "brand" }, "Vantage"), /* @__PURE__ */ React.createElement("div", { className: "vg-ticker", style: { flex: 1, borderBottom: "none" } }, marketBand && marketBand.indexes.map((t) => /* @__PURE__ */ React.createElement("span", { className: "vg-tick", key: t.sym }, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10 } }, t.label), /* @__PURE__ */ React.createElement("b", null, t.price != null ? t.price.toFixed(2) : "\u2014"), /* @__PURE__ */ React.createElement("span", { className: dirCls(t.dayPct) }, signPct(t.dayPct))))), /* @__PURE__ */ React.createElement("span", { style: { padding: "0 14px" } }, /* @__PURE__ */ React.createElement(LiveStatusDots, { settings })), /* @__PURE__ */ React.createElement("div", { className: "tools" }, /* @__PURE__ */ React.createElement(ThemeButton, null), /* @__PURE__ */ React.createElement("button", { className: "tbtn", onClick: () => setSettingsOpen(true) }, "Settings"))), /* @__PURE__ */ React.createElement("div", { className: "vg-studio" }, /* @__PURE__ */ React.createElement("aside", { className: cls("vg-pane", "vg-pane-left", !leftOpen && "clps") }, /* @__PURE__ */ React.createElement("div", { className: "vg-pane-top" }, leftOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, "Workspace"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-collapse",
        title: leftOpen ? "Collapse panel" : "Expand panel",
        "aria-label": leftOpen ? "Collapse navigation panel" : "Expand navigation panel",
        onClick: () => setLeftOpen(!leftOpen)
      },
      leftOpen ? "\xAB" : "\xBB"
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, /* @__PURE__ */ React.createElement("nav", null, NAV.map((g) => /* @__PURE__ */ React.createElement("div", { key: g.group }, leftOpen && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: "10px 8px 4px" } }, g.group), g.items.map((it) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: it.id,
        title: it.label,
        className: cls("vg-navitem", route === it.id && "sel"),
        onClick: () => go(it.id)
      },
      /* @__PURE__ */ React.createElement("span", { className: "ic" }, it.icon),
      leftOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, it.label, it.id === "tax" && tlh2.some((c) => c.status === "clear") && /* @__PURE__ */ React.createElement("span", { className: "vg-navdot" }))
    ))))), leftOpen && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-divider" }), /* @__PURE__ */ React.createElement("div", { className: "vg-scope-head" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Account scope"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-refresh", refreshing.all && "spinning"),
        title: "Refresh all accounts (re-pull holdings + transactions)",
        "aria-label": "Refresh all accounts",
        disabled: !!refreshing.all,
        onClick: onRefreshAll
      },
      /* @__PURE__ */ React.createElement("span", { className: "ic" }, "\u27F3")
    )), /* @__PURE__ */ React.createElement("button", { className: cls("vg-acct", accountId === "all" && "sel"), onClick: () => setAccountId("all") }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", null, "All accounts"), /* @__PURE__ */ React.createElement("div", { className: "meta" }, scopeAccounts.length, " linked")), /* @__PURE__ */ React.createElement("span", { className: "bal" }, moneyByCcy(scopeAccounts.reduce((m, a) => {
      const c = a.currency || "USD";
      m[c] = (m[c] || 0) + a.value;
      return m;
    }, {})))), scopeAccounts.map((a) => {
      const csvOnly = a.refreshable === false;
      const pending = !!refreshing[a.id];
      return /* @__PURE__ */ React.createElement("div", { key: a.id, className: cls("vg-acct", accountId === a.id && "sel"), style: { cursor: "default" } }, /* @__PURE__ */ React.createElement(
        "button",
        {
          onClick: () => setAccountId(a.id),
          style: { all: "unset", cursor: "pointer", flex: 1, minWidth: 0 },
          title: `Scope to ${a.short}`
        },
        /* @__PURE__ */ React.createElement("div", null, a.short),
        /* @__PURE__ */ React.createElement("div", { className: "meta" }, a.type),
        a.lastSynced !== void 0 && /* @__PURE__ */ React.createElement("div", { className: "synced" }, "synced ", syncedAgo(a.lastSynced))
      ), /* @__PURE__ */ React.createElement("span", { className: "bal" }, money(a.value, a.currency || "USD")), /* @__PURE__ */ React.createElement("span", { className: "actions" }, /* @__PURE__ */ React.createElement(
        "button",
        {
          className: cls("vg-refresh", pending && "spinning"),
          title: csvOnly ? "re-import CSV to refresh \u2014 no live API" : `Refresh ${a.short} (re-pull holdings + transactions)`,
          "aria-label": `Refresh ${a.short}`,
          disabled: pending || csvOnly,
          onClick: (e) => {
            e.stopPropagation();
            if (!csvOnly) onRefreshAccount(a.id);
          }
        },
        /* @__PURE__ */ React.createElement("span", { className: "ic" }, "\u27F3")
      )));
    }), refreshNote && /* @__PURE__ */ React.createElement("p", { className: cls("vg-note"), style: { marginTop: 8, padding: "0 4px", color: refreshNote.tone === "warn" ? "var(--color-grey)" : void 0 } }, refreshNote.text), scopeAccounts.length === 0 && scopeOutage && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, padding: "0 4px" } }, "Backend unreachable \u2014 no accounts to show. Start the Vantage server, or import a broker."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10, padding: "0 4px" } }, "Read-only aggregation. Vantage never holds funds or places orders."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, padding: "0 4px" } }, "Vantage \xB7 built on the Lookey design system \xB7 AI analysis is educational only \u2014 not financial, investment, or tax advice.")))), /* @__PURE__ */ React.createElement("main", { id: "vg-center", className: "vg-pane vg-pane-center" }, route === "dashboard" && /* @__PURE__ */ React.createElement(DashboardView, { ...viewProps, ...dashProps, notifs }), route === "holdings" && /* @__PURE__ */ React.createElement(HoldingsView, { ...viewProps }), route === "activity" && /* @__PURE__ */ React.createElement(ActivityView, { ...viewProps }), route === "tax" && /* @__PURE__ */ React.createElement(TaxView, { ...viewProps }), route === "recs" && /* @__PURE__ */ React.createElement(RecsView, { ...viewProps }), route === "markets" && /* @__PURE__ */ React.createElement(MarketsView, { ...viewProps }), route === "options" && /* @__PURE__ */ React.createElement(OptionsView, { accountId, setSymbol, go }), route === "playbook" && /* @__PURE__ */ React.createElement(PlaybookView, { refreshNonce }), route === "paper" && /* @__PURE__ */ React.createElement(PaperView, { refreshNonce }), route === "journal" && /* @__PURE__ */ React.createElement(JournalView, { refreshNonce }), route === "futures" && /* @__PURE__ */ React.createElement(FuturesView, { refreshNonce }), route === "trades" && /* @__PURE__ */ React.createElement(TradeAnalyticsView, { ...viewProps }), route === "charts" && /* @__PURE__ */ React.createElement(ChartsView, { symbol, setSymbol })), /* @__PURE__ */ React.createElement(
      "aside",
      {
        className: cls("vg-pane", "vg-pane-right", !rightOpen && "clps", resizing && "resizing"),
        style: rightOpen ? { width: rightWidth } : void 0
      },
      rightOpen && /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "vg-resize-handle",
          onMouseDown: startResize,
          title: "Drag to resize",
          role: "separator",
          "aria-orientation": "vertical",
          "aria-label": "Resize notebook panel"
        }
      ),
      /* @__PURE__ */ React.createElement("div", { className: "vg-pane-top" }, /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-collapse",
          title: rightOpen ? "Collapse panel" : "Expand panel",
          "aria-label": rightOpen ? "Collapse notebook panel" : "Expand notebook panel",
          onClick: () => setRightOpen(!rightOpen)
        },
        rightOpen ? "\xBB" : "\xAB"
      ), rightOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, hasChartRail ? "AI insights" : symbol ? "Notebook" : "Vantage AI"), rightOpen && !hasChartRail && symbol && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-linkbtn",
          style: { marginLeft: "auto" },
          title: `Open ${underlyingOf(symbol)} on AI Charts`,
          onClick: () => go("charts")
        },
        "chart \u2192"
      )),
      !rightOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-sparkle", "aria-hidden": "true" }, "\u2726"),
      rightOpen && (hasChartRail ? /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-rail" }, /* @__PURE__ */ React.createElement(ChartsRail, { symbol })) : symbol ? /* @__PURE__ */ React.createElement(NotebookPanel, { symbol, accountId, refreshNonce }) : /* @__PURE__ */ React.createElement(ChatPanel, { docked: true, settings }))
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-fabs" }, /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Notifications", onClick: () => setNotifOpen(true) }, "\u{1F514}", unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "cnt" }, unread)), (hasChartRail || !rightOpen) && /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Vantage AI chat", onClick: () => setChatOpen(true) }, "\u{1F4AC}")), notifOpen && /* @__PURE__ */ React.createElement(
      NotifPanel,
      {
        notifs,
        setNotifs,
        settings,
        saveSettings,
        onClose: () => setNotifOpen(false)
      }
    ), chatOpen && /* @__PURE__ */ React.createElement(ChatPanel, { settings, onClose: () => setChatOpen(false) }), settingsOpen && /* @__PURE__ */ React.createElement(
      SettingsModal,
      {
        settings,
        accounts: scopeAccounts,
        onSave: (s) => {
          saveSettings(s);
          setSettingsOpen(false);
        },
        onClose: () => setSettingsOpen(false)
      }
    ));
  }
  function ThemeButton() {
    const [theme, cycle] = useTheme();
    const label = theme === "system" ? "System theme" : theme === "dark" ? "Dark theme" : "Light theme";
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "tbtn",
        onClick: cycle,
        title: `${label} \u2014 click to switch`,
        "aria-label": `Theme: ${theme}. Click to switch.`
      },
      THEME_ICON[theme],
      " ",
      theme
    );
  }
  function LiveStatusDots({ settings }) {
    const [st, setSt] = useState8({ backend: null, mira: null });
    useEffect5(() => {
      let alive = true;
      health().then((h) => {
        if (alive) setSt((s) => ({ ...s, backend: h }));
      });
      if (settings.aiBackend === "mira") {
        miraHealth().then((h) => {
          if (alive) setSt((s) => ({ ...s, mira: h }));
        });
      }
      return () => {
        alive = false;
      };
    }, [settings]);
    const dot = (ok) => ({
      display: "inline-block",
      width: 7,
      height: 7,
      borderRadius: "50%",
      marginRight: 5,
      background: ok ? "var(--vg-up)" : "var(--vg-faint)"
    });
    const aiOff = settings.aiBackend !== "mira";
    return /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { display: "inline-flex", gap: 14, alignItems: "center", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { title: st.backend ? `Backend live at ${settings.backendUrl} \u2014 quotes: ${st.backend.source}${st.backend.stale ? " (stale)" : ""}, as of ${st.backend.as_of}` : `Backend unreachable at ${settings.backendUrl} \u2014 showing demo fixtures` }, /* @__PURE__ */ React.createElement("span", { style: dot(st.backend) }), "data ", st.backend ? "live" : "demo"), /* @__PURE__ */ React.createElement("span", { title: aiOff ? "AI backend set to Off in Settings \u2014 canned demo replies" : st.mira ? `Mira reachable at ${settings.miraUrl}` : `Mira unreachable at ${settings.miraUrl} \u2014 canned demo replies` }, /* @__PURE__ */ React.createElement("span", { style: dot(!aiOff && st.mira) }), "AI ", aiOff ? "off" : st.mira ? "live" : "demo"));
  }
  function buildActionQueue({ decisions, tlh: tlh2, alloc, totalValue, accountId, settings, go, setSymbol }) {
    const jumpChart = (sym) => {
      setSymbol(sym);
      go("charts");
    };
    const out = [];
    for (const d of decisions) {
      if (d.recommendation === "CLOSE_AND_BOOK_LOSS") {
        out.push({
          key: `close-${d.symbol}`,
          weight: 0,
          tone: "bad",
          chip: "CLOSE & BOOK LOSS",
          title: `${d.symbol} \u2014 ${recDetail(d)}`,
          sub: d.rationale || "",
          onJump: () => jumpChart(d.symbol)
        });
      } else if (d.recommendation === "HOLD_AND_SELL_CALL") {
        out.push({
          key: `call-${d.symbol}`,
          weight: 1,
          tone: "info",
          chip: "SELL CALL",
          title: `${d.symbol} \u2014 ${recDetail(d)}`,
          sub: d.rationale || "",
          onJump: () => jumpChart(d.symbol)
        });
      }
    }
    const closeSyms = new Set(out.filter((a) => a.key.startsWith("close-")).map((a) => a.key.slice(6)));
    const bySym = {};
    for (const c of tlh2) {
      if (c.status !== "clear" || closeSyms.has(c.lot.symbol)) continue;
      const g = bySym[c.lot.symbol] ||= { sym: c.lot.symbol, loss: 0, replacement: c.replacement };
      g.loss += -c.unrl;
    }
    for (const g of Object.values(bySym)) {
      const benefit = g.loss * (settings.taxRate / 100);
      out.push({
        key: `harvest-${g.sym}`,
        weight: 2,
        tone: "good",
        chip: "HARVEST",
        title: `${g.sym} \u2014 harvest ${usd(g.loss)} loss \u2248 ${usd(benefit)} benefit`,
        sub: g.replacement ? `Replace with ${g.replacement} to hold exposure and avoid a wash.` : "Wash-clear in taxable accounts.",
        onJump: () => go("tax")
      });
    }
    if (accountId === "all" && totalValue > 0) {
      for (const [k, m] of Object.entries(ASSET_CLASSES)) {
        const pct5 = alloc.byClass[k] / totalValue * 100;
        const drift = pct5 - ALLOCATION_TARGETS[k];
        if (Math.abs(drift) >= 3) {
          out.push({
            key: `drift-${k}`,
            weight: 3,
            tone: drift > 0 ? "warn" : "info",
            chip: "REBALANCE",
            title: `${m.label} ${signPct(drift, 1)} vs target (${pct5.toFixed(1)}% / ${ALLOCATION_TARGETS[k]}%)`,
            sub: drift > 0 ? "Overweight \u2014 trim on the next contribution." : "Underweight \u2014 direct new cash here.",
            onJump: () => go("holdings")
          });
        }
      }
    }
    return out.sort((a, b) => a.weight - b.weight);
  }
  function DashboardView({
    accountId,
    setAccountId,
    settings,
    tlh: tlh2,
    go,
    setSymbol,
    refreshNonce,
    scopeAccounts,
    scopeOutage,
    refreshing,
    refreshNote,
    onRefreshAccount,
    onRefreshAll
  }) {
    const pos = useLive(() => positions(accountId).then(mapPositions), [], [accountId, settings, refreshNonce], { blankOnOutage: true }).data;
    const alloc = useLive(() => allocation(accountId).then(mapAllocation), EMPTY_ALLOC, [accountId, settings, refreshNonce], { blankOnOutage: true }).data;
    const band = useLive(() => quotes().then(mapMarketBand), null, [settings, refreshNonce]).data;
    const miraOn = settings.aiBackend === "mira";
    const report = useLive(() => miraOn ? getInsights().then(mapInsights) : null, null, [settings]).data;
    const analysis = useLive(() => getAnalysis().then(mapAnalysis), null, [settings, refreshNonce]).data;
    const decisions = analysis && analysis.decisions || [];
    const totalValue = alloc.total;
    const byCurrency = alloc.byCurrency || { USD: totalValue };
    const isMixed = Object.keys(byCurrency).filter((k) => byCurrency[k] !== 0).length > 1;
    const dayPlByCcy = pos.reduce((m, p) => {
      const c = p.currency || "USD";
      m[c] = (m[c] || 0) + p.dayPl;
      return m;
    }, {});
    const unrlPlByCcy = pos.reduce((m, p) => {
      const c = p.currency || "USD";
      m[c] = (m[c] || 0) + p.unrl;
      return m;
    }, {});
    const dayPl = dayPlByCcy.USD || 0;
    const unrlPl = unrlPlByCcy.USD || 0;
    const harvestable = tlh2.filter((c) => c.status === "clear");
    const harvestableLoss = harvestable.reduce((s, c) => s + -c.unrl, 0);
    const estBenefit = harvestableLoss * (settings.taxRate / 100);
    const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
    const actions = buildActionQueue({ decisions, tlh: tlh2, alloc, totalValue, accountId, settings, go, setSymbol });
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Dashboard"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 your morning brief \xB7 marked to last close"))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Market today"), band && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, band.source === "fixture" ? "demo feed" : band.source, band.stale ? " \xB7 stale" : "", band.asOf ? ` \xB7 ${band.asOf}` : "")), band ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-marketband", style: { marginTop: 12 } }, band.indexes.map((ix) => /* @__PURE__ */ React.createElement("div", { className: "vg-idx", key: ix.sym }, /* @__PURE__ */ React.createElement("div", { className: "vg-idx-name" }, ix.label), /* @__PURE__ */ React.createElement("div", { className: "vg-idx-price" }, ix.price != null ? ix.price.toFixed(2) : "\u2014"), /* @__PURE__ */ React.createElement("div", { className: cls("vg-idx-pct", dirCls(ix.dayPct)) }, signPct(ix.dayPct))))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10 } }, band.regime, ".")) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 12 } }, "Market data unavailable \u2014 start the backend to see live index levels."), report && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14, borderTop: "1px solid var(--color-border, #e5e7eb)", paddingTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Mira advisor read"), /* @__PURE__ */ React.createElement("span", { className: "vg-row" }, /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u25CF live"), report.confidence && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "confidence ", report.confidence))), report.summary && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, lineHeight: 1.55, margin: "10px 0" } }, report.summary), report.observations.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap" }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("tbody", null, report.observations.map((o, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", { style: { width: 140 } }, /* @__PURE__ */ React.createElement("b", null, o.topic)), /* @__PURE__ */ React.createElement("td", null, o.detail, o.source && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, o.source))))))), report.suggestions.length > 0 && /* @__PURE__ */ React.createElement("ul", { className: "vg-suggestions", style: { marginTop: 10 } }, report.suggestions.map((s, i) => /* @__PURE__ */ React.createElement("li", { key: i }, s))), report.caveats && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8 } }, report.caveats))), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: "20px 2px 6px" } }, "Portfolio today"), /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Total value", value: isMixed ? moneyByCcy(byCurrency) : usd(totalValue) }), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Day P/L",
        value: isMixed ? Object.keys(dayPlByCcy).sort().map((c) => signMoney(dayPlByCcy[c], c)).join(" \xB7 ") : signUsd(dayPl),
        deltaDir: dirCls(dayPl),
        delta: totalValue ? signPct(dayPl / (totalValue - dayPl) * 100) : ""
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Unrealized P/L",
        value: isMixed ? Object.keys(unrlPlByCcy).sort().map((c) => signMoney(unrlPlByCcy[c], c)).join(" \xB7 ") : signUsd(unrlPl),
        deltaDir: dirCls(unrlPl),
        delta: totalValue ? signPct(unrlPl / (totalValue - unrlPl) * 100) : ""
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Harvestable losses",
        value: usd(harvestableLoss),
        note: `\u2248 ${usd(estBenefit)} est. benefit at ${settings.taxRate}%`
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 14.5 } }, "Allocation by asset class"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "target 70 / 10 / 15 / 5")), /* @__PURE__ */ React.createElement("div", { className: "vg-allocbar", style: { marginTop: 12 }, role: "img", "aria-label": "Asset allocation" }, Object.entries(ASSET_CLASSES).map(([k, m]) => {
      const pct5 = totalValue ? alloc.byClass[k] / totalValue * 100 : 0;
      return pct5 > 0 && /* @__PURE__ */ React.createElement("span", { key: k, style: { width: `${pct5}%`, background: m.color }, title: `${m.label} ${pct5.toFixed(1)}%` });
    })), /* @__PURE__ */ React.createElement("div", { className: "vg-legend" }, Object.entries(ASSET_CLASSES).map(([k, m]) => {
      const pct5 = totalValue ? alloc.byClass[k] / totalValue * 100 : 0;
      const drift = pct5 - ALLOCATION_TARGETS[k];
      return /* @__PURE__ */ React.createElement("span", { key: k }, /* @__PURE__ */ React.createElement("span", { className: "sw", style: { background: m.color } }), m.label, " ", /* @__PURE__ */ React.createElement("span", { className: "num" }, pct5.toFixed(1), "%"), " ", accountId === "all" && Math.abs(drift) >= 3 && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", drift > 0 ? "warn" : "info") }, signPct(drift, 1), " vs target"));
    }))), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { margin: "20px 2px 6px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Accounts today"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-refresh", refreshing.all && "spinning"),
        title: "Refresh all accounts",
        "aria-label": "Refresh all accounts",
        disabled: !!refreshing.all,
        onClick: onRefreshAll
      },
      /* @__PURE__ */ React.createElement("span", { className: "ic" }, "\u27F3"),
      " ",
      /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, "refresh all")
    )), scopeAccounts.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, scopeOutage ? "Backend unreachable \u2014 no accounts to show." : "No linked accounts yet \u2014 import a broker.")) : /* @__PURE__ */ React.createElement("div", { className: "vg-acctgrid" }, scopeAccounts.map((a) => {
      const csvOnly = a.refreshable === false;
      const pending = !!refreshing[a.id];
      return /* @__PURE__ */ React.createElement("div", { key: a.id, className: cls("vg-acctcard", accountId === a.id && "sel") }, /* @__PURE__ */ React.createElement("button", { className: "vg-acctcard-main", onClick: () => setAccountId(a.id), title: `Scope to ${a.short}` }, /* @__PURE__ */ React.createElement("div", { className: "vg-acctcard-name" }, a.short), /* @__PURE__ */ React.createElement("div", { className: "vg-acctcard-val" }, money(a.value, a.currency || "USD")), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, a.type, a.lastSynced !== void 0 ? ` \xB7 synced ${syncedAgo(a.lastSynced)}` : "")), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: cls("vg-refresh", pending && "spinning"),
          title: csvOnly ? "re-import CSV to refresh \u2014 no live API" : `Refresh ${a.short}`,
          "aria-label": `Refresh ${a.short}`,
          disabled: pending || csvOnly,
          onClick: (e) => {
            e.stopPropagation();
            if (!csvOnly) onRefreshAccount(a.id);
          }
        },
        /* @__PURE__ */ React.createElement("span", { className: "ic" }, "\u27F3")
      ));
    })), refreshNote && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, color: refreshNote.tone === "warn" ? "var(--color-grey)" : void 0 } }, refreshNote.text), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { margin: "20px 2px 6px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Actions", actions.length ? ` (${actions.length})` : ""), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => go("recs") }, "All recommendations \u2192")), actions.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, analysis ? "Nothing needs you today \u2014 no close, covered-call, harvest, or rebalance actions. Monitoring the rest." : "The decision journal is empty or the backend is unreachable. Run the nightly analysis and confirm the backend URL in Settings.")) : /* @__PURE__ */ React.createElement("div", { className: "vg-actionq" }, actions.map((a) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: a.key,
        className: "vg-action",
        onClick: a.onJump,
        role: "button",
        tabIndex: 0,
        onKeyDown: (e) => {
          if (e.key === "Enter") a.onJump();
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", a.tone), style: { flexShrink: 0 } }, a.chip),
      /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-action-title" }, a.title), a.sub && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, a.sub)),
      /* @__PURE__ */ React.createElement("span", { className: "vg-action-go", "aria-hidden": "true" }, "\u2192")
    ))));
  }
  function HoldingRec({ d, onOpen }) {
    if (!d) return /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014");
    const rec = REC_CHIP[d.recommendation] || { cls: "plain", text: d.recommendation };
    const a = d.action || {};
    let detail = "";
    if (d.recommendation === "HOLD_AND_SELL_CALL" && a.suggestedStrike != null) {
      detail = `sell ${Number(a.suggestedStrike).toFixed(2)}C ~${usd(a.estCredit || 0)}`;
    } else if (d.recommendation === "CLOSE_AND_BOOK_LOSS" && a.unrealizedLoss != null) {
      detail = `book ${signUsd(a.unrealizedLoss)}`;
    } else if (d.recommendation === "HOLD_WASH_BLOCKED") {
      detail = a.washClearsOn ? `clears ${a.washClearsOn}` : "wash-blocked";
    }
    return /* @__PURE__ */ React.createElement(
      "span",
      {
        title: d.rationale || "",
        onClick: (e) => {
          e.stopPropagation();
          onOpen && onOpen(d.symbol);
        },
        style: { cursor: onOpen ? "pointer" : "default" }
      },
      /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", rec.cls) }, rec.text),
      detail && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 6 } }, detail)
    );
  }
  var HOLD_SORTS = {
    action: { label: "Action priority", key: (p) => REC_ORDER[p._rec?.recommendation] ?? 9, dir: 1 },
    value: { label: "Value", key: (p) => p.value, dir: -1 },
    unrl: { label: "Unrealized", key: (p) => p.unrl, dir: -1 },
    weight: { label: "Weight", key: (p) => p.weight, dir: -1 },
    day: { label: "Day P/L", key: (p) => p.dayPl || 0, dir: -1 },
    symbol: { label: "Symbol", key: (p) => p.symbol, dir: 1 }
  };
  function optionLegLabel(sym) {
    const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)([CP])$/.exec(sym);
    if (!m) return sym;
    const [, , exp, strike, cp] = m;
    return `$${Number(strike).toFixed(0)}${cp} ${fmtDate(exp)}`;
  }
  function optionMatchKeyFrom(strike, expiration, optionType) {
    return `${Number(strike)}|${expiration}|${(optionType || "").toLowerCase()}`;
  }
  function optionMatchKey(sym) {
    const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)([CP])$/.exec(sym);
    if (!m) return sym.toUpperCase();
    const [, , exp, strike, cp] = m;
    return optionMatchKeyFrom(strike, exp, cp === "C" ? "call" : "put");
  }
  function HoldingsView({ accountId, settings, go, setSymbol, refreshNonce }) {
    const [expanded, setExpanded] = useState8({});
    const [sortKey, setSortKey] = useState8("value");
    const [recFilter, setRecFilter] = useState8("all");
    const [kindFilter, setKindFilter] = useState8("all");
    const [query, setQuery] = useState8("");
    const pos = useLive(() => positions(accountId).then(mapPositions), [], [accountId, settings, refreshNonce], { blankOnOutage: true }).data;
    const analysis = useLive(() => getAnalysis().then(mapAnalysis), null, [settings, refreshNonce]).data;
    const byUnderlying = useMemo6(() => {
      const m = {};
      for (const d of analysis?.decisions || []) m[underlyingOf(d.symbol)] = d;
      return m;
    }, [analysis]);
    const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
    const groups = useMemo6(() => {
      const by = {};
      for (const p of pos) {
        if (p.symbol === "CASH") continue;
        const key = underlyingOf(p.symbol);
        const g = by[key] ||= {
          key,
          equity: null,
          options: [],
          sleeve: null,
          value: 0,
          dayPl: 0,
          unrl: 0,
          weight: 0,
          currency: p.currency || "USD"
        };
        if (isOptionSym(p.symbol)) g.options.push(p);
        else if (p.symbol === "CRYPTO" || p.symbol === "FUTURES") g.sleeve = p;
        else g.equity = p;
        g.value += p.value || 0;
        g.dayPl += p.dayPl || 0;
        g.unrl += p.unrl || 0;
        g.weight += p.weight || 0;
      }
      let list = Object.values(by).map((g) => {
        const rec = byUnderlying[g.key] || null;
        const legActs = {};
        for (const a of rec?.legActions || []) {
          if (a.occSymbol) legActs[a.occSymbol.toUpperCase()] = a;
          legActs[optionMatchKeyFrom(a.strike, a.expiration, a.optionType)] = a;
        }
        return { ...g, _rec: rec, _legActs: legActs };
      });
      const q = query.trim().toUpperCase();
      list = list.filter((g) => {
        if (q && !g.key.includes(q)) return false;
        if (kindFilter === "equity" && !g.equity) return false;
        if (kindFilter === "option" && g.options.length === 0) return false;
        if (kindFilter === "losers" && !(g.unrl < 0)) return false;
        if (recFilter === "actionable" && (REC_ORDER[g._rec?.recommendation] ?? 9) > 1) return false;
        if (recFilter !== "all" && recFilter !== "actionable" && g._rec?.recommendation !== recFilter) return false;
        return true;
      });
      const s = HOLD_SORTS[sortKey] || HOLD_SORTS.value;
      const keyFor = (g) => {
        if (sortKey === "symbol") return g.key;
        if (sortKey === "action") return REC_ORDER[g._rec?.recommendation] ?? 9;
        if (sortKey === "unrl") return g.unrl;
        if (sortKey === "weight") return g.weight;
        if (sortKey === "day") return g.dayPl;
        return g.value;
      };
      return list.sort((a, b) => {
        const ka = keyFor(a), kb = keyFor(b);
        const cmp = typeof ka === "string" ? ka.localeCompare(kb) : ka - kb;
        return cmp * s.dir;
      });
    }, [pos, byUnderlying, query, kindFilter, recFilter, sortKey]);
    const openChart = (sym) => {
      if (setSymbol) setSymbol(underlyingOf(sym));
      if (go) go("charts");
    };
    const actionable = groups.filter((g) => (REC_ORDER[g._rec?.recommendation] ?? 9) <= 1).length;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Holdings"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 ", groups.length, " ticker", groups.length === 1 ? "" : "s", analysis ? ` \xB7 ${actionable} actionable` : "", " \xB7 grouped by symbol \xB7 click to expand"), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { gap: 8, flexWrap: "wrap", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, [["all", "All"], ["equity", "Has equity"], ["option", "Has options"], ["losers", "Losers"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: cls("vg-pill", kindFilter === k && "sel"), onClick: () => setKindFilter(k) }, l))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("select", { className: "vg-select", value: recFilter, onChange: (e) => setRecFilter(e.target.value), title: "Filter by recommendation" }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Any recommendation"), /* @__PURE__ */ React.createElement("option", { value: "actionable" }, "Actionable only"), /* @__PURE__ */ React.createElement("option", { value: "HOLD_AND_SELL_CALL" }, "Hold & sell call"), /* @__PURE__ */ React.createElement("option", { value: "CLOSE_AND_BOOK_LOSS" }, "Close & book loss"), /* @__PURE__ */ React.createElement("option", { value: "MONITOR" }, "Monitor")), /* @__PURE__ */ React.createElement("select", { className: "vg-select", value: sortKey, onChange: (e) => setSortKey(e.target.value), title: "Sort by" }, Object.entries(HOLD_SORTS).map(([k, s]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, "Sort: ", s.label))), /* @__PURE__ */ React.createElement("input", { className: "vg-input", placeholder: "Search symbol\u2026", value: query, onChange: (e) => setQuery(e.target.value), style: { width: 130 } }))), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Symbol"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Value"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Day"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Weight"), /* @__PURE__ */ React.createElement("th", null, "Recommendation"))), /* @__PURE__ */ React.createElement("tbody", null, groups.map((g) => {
      const isOpen = !!expanded[g.key];
      const sleeve = !!g.sleeve && !g.equity && g.options.length === 0;
      const nOpts = g.options.length;
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: g.key }, /* @__PURE__ */ React.createElement("tr", { className: "click vg-grouprow", onClick: () => {
        if (setSymbol && !sleeve) setSymbol(g.key);
        setExpanded((e) => ({ ...e, [g.key]: !e[g.key] }));
      } }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-caret" }, isOpen ? "\u25BE" : "\u25B8"), /* @__PURE__ */ React.createElement("b", null, g.key), nOpts > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-chip", style: { marginLeft: 6 }, title: `${nOpts} option leg(s)` }, nOpts, " OPT"), g.equity && g.equity.overlap && accountId === "all" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info", style: { marginLeft: 6 }, title: `Held as ${g.equity.overlap.symbols.join(", ")}` }, "Overlap"), g.equity && g.equity.weight > 7 && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { marginLeft: 6 } }, "Concentrated"), sleeve && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "sleeve \u2014 value via broker portfolio")), /* @__PURE__ */ React.createElement("td", { className: "num" }, money(g.value, g.currency)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(g.dayPl)) }, g.dayPl ? signMoney(g.dayPl, g.currency) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(g.unrl)) }, signMoney(g.unrl, g.currency)), /* @__PURE__ */ React.createElement("td", { className: "num" }, g.weight.toFixed(1), "%"), /* @__PURE__ */ React.createElement("td", null, sleeve ? /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014") : /* @__PURE__ */ React.createElement(HoldingRec, { d: g._rec, onOpen: openChart }))), isOpen && g.equity && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow vg-subhead" }, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { paddingLeft: 26 } }, "Equity \xB7 ", g.equity.shares, " sh")), g.equity.lots.map((l, i) => /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow", key: `eq-${i}` }, /* @__PURE__ */ React.createElement("td", { style: { paddingLeft: 34 } }, "lot \xB7 ", fmtDate(l.date)), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(lotValue(l))), /* @__PURE__ */ React.createElement("td", { className: "num" }, `${l.shares} sh @ ${usd(l.costPerShare, 2)}`), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(lotUnrl(l))) }, signUsd(lotUnrl(l))), /* @__PURE__ */ React.createElement("td", { className: "num", colSpan: 2 }, daysAgo(l.date) > 365 ? "long-term" : "short-term")))), isOpen && nOpts > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow vg-subhead" }, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { paddingLeft: 26 } }, "Options \xB7 ", nOpts, " leg(s)")), g.options.map((p) => {
        const a = g._legActs[p.symbol.toUpperCase()] || g._legActs[optionMatchKey(p.symbol)] || null;
        return /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow vg-legrow", key: p.symbol }, /* @__PURE__ */ React.createElement("td", { style: { paddingLeft: 34 } }, optionLegLabel(p.symbol)), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(p.value)), /* @__PURE__ */ React.createElement("td", { className: "num" }, "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(p.unrl)) }, signUsd(p.unrl)), /* @__PURE__ */ React.createElement("td", { className: "num" }), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(LegActionChip, { a })));
      })));
    }), groups.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, className: "vg-note", style: { padding: 16 } }, "No holdings match the current filters."))))));
  }
  var ACTIVITY_PAGE = 50;
  var ACTIVITY_KINDS = [
    { id: "all", label: "All" },
    { id: "equity", label: "Equities" },
    { id: "option", label: "Options" }
  ];
  function fmtWhen2(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return { day: iso ? String(iso) : "\u2014", time: "" };
    return {
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    };
  }
  function ActivityView({ accountId, settings, refreshNonce }) {
    const [kind, setKind] = useState8("all");
    const [shown, setShown] = useState8(ACTIVITY_PAGE);
    const rows = useLive(
      () => getHistory(accountId).then(mapHistory),
      null,
      [accountId, settings, refreshNonce]
    ).data;
    useEffect5(() => {
      setShown(ACTIVITY_PAGE);
    }, [accountId, kind]);
    const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
    const all = rows || [];
    const filtered = kind === "all" ? all : all.filter((r) => r.kind === kind);
    const visible = filtered.slice(0, shown);
    const signedAmt = (n) => `${n >= 0 ? "+" : "\u2212"}${usd(Math.abs(n), 2)}`;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Activity"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 imported broker transaction history \xB7 newest first"), all.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No activity imported yet"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0", maxWidth: 560 } }, "Transaction history arrives with a broker import \u2014 run the importer with ", /* @__PURE__ */ React.createElement("b", null, "--with-history"), " and this view fills in. There is no demo fixture for account history, so it stays empty offline."), /* @__PURE__ */ React.createElement("pre", { style: {
      background: "var(--color-light)",
      border: "1px solid var(--color-border)",
      borderRadius: 8,
      padding: "10px 12px",
      margin: "10px 0 0",
      fontSize: 12,
      lineHeight: 1.5,
      overflowX: "auto"
    } }, /* @__PURE__ */ React.createElement("code", null, "cd server\n.venv/bin/python -m vantage_server.importer \\\n    --broker robinhood --account rh-margin --with-history"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { padding: "6px 4px 8px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, ACTIVITY_KINDS.map((f) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: f.id,
        className: cls("vg-pill", kind === f.id && "sel"),
        onClick: () => setKind(f.id)
      },
      f.label
    ))), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, filtered.length === all.length ? `${all.length} events` : `${filtered.length} of ${all.length} events`)), /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Date"), /* @__PURE__ */ React.createElement("th", null, "Account"), /* @__PURE__ */ React.createElement("th", null, "Symbol"), /* @__PURE__ */ React.createElement("th", null, "Side"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Qty"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Price"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Amount"), /* @__PURE__ */ React.createElement("th", null, "Status"))), /* @__PURE__ */ React.createElement("tbody", null, visible.map((r, i) => {
      const w = fmtWhen2(r.date);
      return /* @__PURE__ */ React.createElement("tr", { key: i, style: r.state === "cancelled" ? { opacity: 0.55 } : void 0 }, /* @__PURE__ */ React.createElement("td", null, w.day, w.time && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, w.time)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, acctOf(r.account).short)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, r.symbol || "\u2014"), r.kind === "option" && /* @__PURE__ */ React.createElement("span", { className: "vg-chip", style: { marginLeft: 6 }, title: "option contract" }, "OPT"), r.description && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, r.description)), /* @__PURE__ */ React.createElement("td", null, r.side === "buy" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "Buy"), r.side === "sell" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "Sell"), r.side !== "buy" && r.side !== "sell" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.qty != null ? r.qty : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.price != null ? usd(r.price, 2) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(r.amount || 0)) }, r.amount != null ? signedAmt(r.amount) : "\u2014"), /* @__PURE__ */ React.createElement("td", null, r.state === "filled" && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5 } }, "filled"), r.state === "open" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "open"), r.state === "cancelled" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "cancelled"), r.state && !["filled", "open", "cancelled"].includes(r.state) && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, r.state), !r.state && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")));
    })))), filtered.length > shown && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setShown(shown + ACTIVITY_PAGE) }, "Show ", Math.min(ACTIVITY_PAGE, filtered.length - shown), " more \xB7 ", filtered.length - shown, " remaining"))));
  }
  function TaxView({ settings, tlh: tlh2 }) {
    const [washFaqOpen, setWashFaqOpen] = useState8(false);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Tax Center \u2014 loss harvesting"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Every lot marked to last close \xB7 wash-sale window checked across ", /* @__PURE__ */ React.createElement("b", null, "all linked accounts"), " \xB7 threshold ", usd(settings.thresholdUsd), " or ", settings.thresholdPct, "% \xB7 decision-support only, no orders placed"), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Lot"), /* @__PURE__ */ React.createElement("th", null, "Account"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", null, "Status"), /* @__PURE__ */ React.createElement("th", null, "Action"))), /* @__PURE__ */ React.createElement("tbody", null, tlh2.map((c, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, c.lot.symbol), " \xB7 ", c.lot.shares, " sh @ ", usd(c.lot.costPerShare, 2), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "bought ", fmtDate(c.lot.date))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, c.acct.short)), /* @__PURE__ */ React.createElement("td", { className: "num down" }, signUsd(c.unrl), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", signPct(-c.lossPct), ")")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u2713 Clear to harvest"), c.status === "blocked" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Wash-sale blocked"), c.status === "below" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "Below threshold"), c.status === "na" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "N/A \u2014 tax-advantaged"), c.status === "blocked" && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { maxWidth: 320, marginTop: 4 } }, c.wash.reason, ". Clears ", c.wash.clearsOn === "auto-buy paused" ? "once the auto-buy is paused" : c.wash.clearsOn, ".")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && (c.replacement ? /* @__PURE__ */ React.createElement("span", null, "Sell \u2192 buy ", /* @__PURE__ */ React.createElement("b", null, c.replacement), " ", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "different index, near-identical exposure")) : /* @__PURE__ */ React.createElement("span", null, "Sell, wait 31 days to rebuy", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "no like-exposure partner for single stock"))), c.status === "blocked" && c.wash.futureRisk && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Pause ", c.wash.futureRisk.symbol, " auto-buy to open a window"), (c.status === "below" || c.status === "na") && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Monitor"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement(
      FAQItem3,
      {
        question: "Why does a buy in my IRA block a harvest in my brokerage account?",
        open: washFaqOpen,
        onToggle: () => setWashFaqOpen(!washFaqOpen)
      },
      "The IRS wash-sale rule disallows a loss if you buy a substantially identical security within 30 days before or after the sale \u2014 in any of your accounts, including IRAs (Rev. Rul. 2008-5) and a spouse's accounts. Single-account tools miss this; Vantage checks every linked account plus scheduled auto-invests before calling a loss harvestable. Estimated benefit assumes your ",
      settings.taxRate,
      "% marginal rate \u2014 change it in Settings."
    )));
  }
  var CONVICTION_CHIP = {
    strong: { cls: "good", text: "STRONG" },
    neutral: { cls: "plain", text: "NEUTRAL" },
    weak: { cls: "warn", text: "WEAK" },
    freefall: { cls: "bad", text: "FREEFALL" }
  };
  var REC_CHIP = {
    HOLD_AND_SELL_CALL: { cls: "info", text: "HOLD & SELL CALL" },
    CLOSE_AND_BOOK_LOSS: { cls: "bad", text: "CLOSE & BOOK LOSS" },
    HOLD_WASH_BLOCKED: { cls: "warn", text: "HOLD \u2014 WASH BLOCKED" },
    MONITOR: { cls: "plain", text: "MONITOR" }
  };
  var REC_ORDER = { CLOSE_AND_BOOK_LOSS: 0, HOLD_AND_SELL_CALL: 1, HOLD_WASH_BLOCKED: 2, MONITOR: 3 };
  var LEG_ACTION_CHIP = {
    DEFEND: { cls: "bad", text: "DEFEND" },
    CLOSE_LEG: { cls: "bad", text: "CLOSE" },
    TAKE_PROFIT: { cls: "good", text: "TAKE PROFIT" },
    ROLL_UP: { cls: "info", text: "ROLL UP" },
    ROLL_DOWN: { cls: "warn", text: "ROLL DOWN" },
    ROLL_OUT: { cls: "warn", text: "ROLL OUT" },
    LET_EXPIRE: { cls: "plain", text: "LET EXPIRE" },
    HOLD_LEG: { cls: "plain", text: "HOLD" }
  };
  function LegActionChip({ a }) {
    if (!a) return /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014");
    const chip = LEG_ACTION_CHIP[a.action] || { cls: "plain", text: a.action };
    let detail = `${a.dte}DTE \xB7 ${a.moneyness}`;
    if (a.target && a.target.strike != null) detail += ` \u2192 $${Number(a.target.strike).toFixed(0)}`;
    else if (a.target && a.target.expiry) detail += ` \u2192 ${a.target.expiry}`;
    return /* @__PURE__ */ React.createElement("span", { title: a.rationale || "" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", chip.cls) }, chip.text), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 6 } }, detail));
  }
  function recDetail(d) {
    const a = d.action;
    if (!a) return d.rationale || "";
    if (a.kind === "sell_call" && a.suggestedStrike != null) {
      const strike = Number(a.suggestedStrike).toFixed(2);
      const credit = a.estCredit != null ? `~$${Math.round(a.estCredit)}` : "";
      const basis = a.currentNetCost != null && a.projectedNetCost != null ? `, basis $${Math.round(a.currentNetCost)}\u2192$${Math.round(a.projectedNetCost)}` : "";
      return `sell ${strike}C ${credit}${basis}`;
    }
    if (a.kind === "close") {
      const loss = a.unrealizedLoss != null ? `book $${Math.round(Math.abs(a.unrealizedLoss))}` : "book loss";
      const weeks = a.weeksToOffset != null ? `, ${a.weeksToOffset}wk to offset` : "";
      const wash2 = a.washBlocked ? " \xB7 WASH BLOCKED" : "";
      return `${loss}${weeks}${wash2}`;
    }
    return d.rationale || "";
  }
  function tfTrend(perTf, name) {
    const tf = perTf && perTf[name];
    if (!tf || !tf.trend) return `${name}: \u2014`;
    return `${name}: ${tf.trend.direction} (${tf.trend.structure})`;
  }
  function RecRow2({ d, onJump }) {
    const [open, setOpen] = useState8(false);
    const conv = CONVICTION_CHIP[d.conviction.label] || CONVICTION_CHIP.neutral;
    const rec = REC_CHIP[d.recommendation] || { cls: "plain", text: d.recommendation };
    const ev = d.evidence || {};
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { className: "vg-recrow", style: { cursor: "pointer" } }, /* @__PURE__ */ React.createElement("td", { onClick: () => onJump(d.symbol) }, /* @__PURE__ */ React.createElement("b", null, d.symbol)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", conv.cls) }, conv.text)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", rec.cls) }, rec.text)), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 13 } }, recDetail(d)), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setOpen(!open) }, open ? "hide" : "evidence"), " \xB7 ", /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => onJump(d.symbol) }, "chart \u2192"))), open && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 5, style: { background: "var(--color-light)", padding: "12px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.6 } }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 8px" } }, d.rationale), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 18, flexWrap: "wrap", color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, tfTrend(ev.perTf, "daily")), /* @__PURE__ */ React.createElement("span", null, tfTrend(ev.perTf, "weekly")), /* @__PURE__ */ React.createElement("span", null, tfTrend(ev.perTf, "monthly"))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 18, flexWrap: "wrap", marginTop: 6, color: "var(--color-grey)" } }, ev.nearestSupport && /* @__PURE__ */ React.createElement("span", null, "nearest support ", Number(ev.nearestSupport.price).toFixed(2), " (str ", ev.nearestSupport.strength, ")"), ev.nearestResistance && /* @__PURE__ */ React.createElement("span", null, "nearest resistance ", Number(ev.nearestResistance.price).toFixed(2), " (str ", ev.nearestResistance.strength, ")"), /* @__PURE__ */ React.createElement("span", null, "broke support w/ momentum: ", ev.brokeSupportWithMomentum ? "yes" : "no"), /* @__PURE__ */ React.createElement("span", null, "rule: ", d.rule))))));
  }
  function RecsView({ settings, setSymbol, go }) {
    const analysis = useLive(() => getAnalysis().then(mapAnalysis), null, [settings]);
    const data = analysis.data;
    const decisions = data && data.decisions || [];
    const sorted = [...decisions].sort((a, b) => {
      const wa = REC_ORDER[a.recommendation] ?? 9, wb = REC_ORDER[b.recommendation] ?? 9;
      if (wa !== wb) return wa - wb;
      return a.symbol.localeCompare(b.symbol);
    });
    const jump = (sym) => {
      setSymbol(sym);
      go("charts");
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Recommendations"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Persisted decision journal", data && data.asOf ? ` \xB7 as of ${data.asOf}` : "", " \xB7 actionable first \xB7 educational only, not advice"), sorted.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No analysis available"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, "The decision journal is empty or the backend is unreachable. Run the nightly analysis (", /* @__PURE__ */ React.createElement("code", null, "python -m vantage_server.analyze"), ") and confirm the backend URL in Settings.")) : /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8, padding: 0, overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Symbol"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Conviction"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Recommendation"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Detail"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px", textAlign: "right" } }))), /* @__PURE__ */ React.createElement("tbody", null, sorted.map((d) => /* @__PURE__ */ React.createElement(RecRow2, { key: d.symbol, d, onJump: jump }))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 2 } }, "Options income"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Executable covered-call ideas on your book \u2014 see Options Intelligence.")), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => go("options") }, "Open Options Intel \u2192"))));
  }
  function MarketsView({ setSymbol, go, settings }) {
    const [signalsTab, setSignalsTab] = useState8("active");
    const signals = useLive(() => getSignals().then(mapSignals), [], [settings], { blankOnOutage: true }).data;
    const isPastSignal = (s) => s.status === "hit-target" || s.status === "stopped";
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Pattern signals"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Backend-graded technical signals \xB7 statuses computed from live quotes, never authored \xB7 educational only"), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "AI pattern signals"), /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", signalsTab === "active" && "sel"), onClick: () => setSignalsTab("active") }, "Active (", signals.filter((s) => !isPastSignal(s)).length, ")"), /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", signalsTab === "past" && "sel"), onClick: () => setSignalsTab("past") }, "Past (", signals.filter(isPastSignal).length, ")"))), /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Ticker"), /* @__PURE__ */ React.createElement("th", null, "Pattern"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Entry"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Target"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Stop"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Move"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Conf"), /* @__PURE__ */ React.createElement("th", null, "Status"))), /* @__PURE__ */ React.createElement("tbody", null, signals.filter((s) => signalsTab === "active" ? !isPastSignal(s) : isPastSignal(s)).map((s) => /* @__PURE__ */ React.createElement("tr", { key: s.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, s.sym), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.time)), /* @__PURE__ */ React.createElement("td", null, s.pattern), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.entry.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.target.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.stop.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(s.movePct || 0)) }, s.movePct != null ? signPct(s.movePct, 1) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.conf != null ? `${s.conf}%` : "\u2014"), /* @__PURE__ */ React.createElement("td", null, s.status === "active" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u25CF Active"), s.status === "hit-target" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "\u2713 Hit target"), s.status === "stopped" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Stopped"), s.status === "unquoted" && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-badge plain",
        title: "no quote for this symbol \u2014 statuses are computed, never authored"
      },
      "\u25CC Unquoted"
    ), s.grade && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-chip",
        style: { marginLeft: 6 },
        title: s.pnlPct != null ? `progress grade ${s.grade} \xB7 P/L ${signPct(s.pnlPct, 1)}` : `progress grade ${s.grade}`
      },
      s.grade
    )))))))));
  }
  function NotifPanel({ notifs, setNotifs, settings, saveSettings, onClose }) {
    const visible = notifs.filter((n) => settings.notifPrefs[n.type]);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-scrim", onClick: onClose }), /* @__PURE__ */ React.createElement("div", { className: "vg-panel" }, /* @__PURE__ */ React.createElement("div", { className: "vg-panel-head" }, /* @__PURE__ */ React.createElement("h3", null, "Notifications"), /* @__PURE__ */ React.createElement("div", { className: "vg-row" }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setNotifs(notifs.map((n) => ({ ...n, read: true }))) }, "Mark all read"), /* @__PURE__ */ React.createElement("button", { className: "vg-x", "aria-label": "Close", onClick: onClose }, "\xD7"))), /* @__PURE__ */ React.createElement("div", { className: "vg-panel-body" }, visible.map((n) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: n.id,
        className: cls("vg-notif", !n.read && "unread"),
        onClick: () => setNotifs(notifs.map((x) => x.id === n.id ? { ...x, read: true } : x))
      },
      !n.read && /* @__PURE__ */ React.createElement("span", { className: "vg-dot" }),
      /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "t" }, NOTIF_TYPES[n.type].icon, " ", n.title), /* @__PURE__ */ React.createElement("div", { className: "b" }, n.body), /* @__PURE__ */ React.createElement("div", { className: "when" }, n.time, " \xB7 ", NOTIF_TYPES[n.type].label))
    )), visible.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "All notification types are muted in preferences below."), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--color-border)", marginTop: 16, paddingTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Preferences"), Object.entries(NOTIF_TYPES).map(([k, m]) => /* @__PURE__ */ React.createElement("label", { className: "vg-toggle", key: k }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: settings.notifPrefs[k],
        onChange: (e) => saveSettings({ ...settings, notifPrefs: { ...settings.notifPrefs, [k]: e.target.checked } })
      }
    ), m.icon, " ", m.label))))));
  }
  function ChatPanel({ settings, onClose, docked }) {
    const useMira = settings.aiBackend === "mira";
    const [msgs, setMsgs] = useState8([
      { who: "ai", text: "Hi \u2014 I'm Vantage AI. I can see across all 4 of your linked accounts. Ask me about harvesting, wash sales, overlap, or your allocation." }
    ]);
    const [draft, setDraft] = useState8("");
    const [busy, setBusy] = useState8(false);
    const bodyRef = useRef3(null);
    const abortRef = useRef3(null);
    useEffect5(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs]);
    useEffect5(() => () => {
      if (abortRef.current) abortRef.current();
    }, []);
    const patchLast = (fn) => setMsgs((m) => m.map((x, i) => i === m.length - 1 ? fn(x) : x));
    const cannedReply = () => "The AI advisor is offline. Start Mira (and the backend) to ask grounded questions about your book \u2014 I won't invent numbers.";
    const send = () => {
      const text = draft.trim();
      if (!text || busy) return;
      setDraft("");
      if (!useMira) {
        setMsgs((m) => [...m, { who: "me", text }]);
        setTimeout(() => setMsgs((m) => [...m, { who: "ai", text: cannedReply(text) }]), 450);
        return;
      }
      setMsgs((m) => [...m, { who: "me", text }, { who: "ai", text: "", plan: [], pending: true }]);
      setBusy(true);
      let gotText = false;
      abortRef.current = streamTurn(text, threadId(), (evt) => {
        if (evt.kind === "plan_step") {
          patchLast((l) => ({ ...l, plan: [...l.plan || [], evt.phase ? `${evt.step} (${evt.phase})` : String(evt.step)] }));
        } else if (evt.kind === "token") {
          gotText = true;
          patchLast((l) => ({ ...l, text: l.text + (evt.text || "") }));
        } else if (evt.kind === "done") {
          setBusy(false);
          patchLast((l) => ({ ...l, pending: false, corr: evt.correlation_id || null }));
        } else if (evt.kind === "error") {
          setBusy(false);
          patchLast((l) => gotText ? { ...l, pending: false, offline: true } : { ...l, text: cannedReply(text), plan: [], pending: false, offline: true });
        }
      });
    };
    const toggleExplain = (i) => {
      const m = msgs[i];
      const opening = !m.explainOpen;
      setMsgs((ms) => ms.map((x, j) => j === i ? { ...x, explainOpen: opening } : x));
      if (opening && m.explain === void 0 && m.corr) {
        getExplanation(m.corr).then((payload) => {
          const rec = payload && Array.isArray(payload.records) && payload.records.length ? payload.records[0] : null;
          setMsgs((ms) => ms.map((x, j) => j === i ? { ...x, explain: rec } : x));
        });
      }
    };
    const inner = /* @__PURE__ */ React.createElement(React.Fragment, null, !docked && /* @__PURE__ */ React.createElement("div", { className: "vg-panel-head" }, /* @__PURE__ */ React.createElement("h3", null, "Vantage AI"), /* @__PURE__ */ React.createElement("button", { className: "vg-x", "aria-label": "Close", onClick: onClose }, "\xD7")), /* @__PURE__ */ React.createElement("div", { className: "vg-panel-body", ref: bodyRef }, msgs.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: cls("vg-msg", m.who) }, m.plan && m.plan.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11.5, opacity: 0.65, marginBottom: 6 } }, m.plan.map((s, j) => /* @__PURE__ */ React.createElement("div", { key: j }, "\xB7 ", s))), m.text || (m.pending ? "\u2026" : ""), m.offline && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 6 } }, "offline \u2014 canned reply"), m.who === "ai" && m.corr && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", style: { fontSize: 11.5 }, onClick: () => toggleExplain(i) }, m.explainOpen ? "hide explanation" : "explain"), m.explainOpen && /* @__PURE__ */ React.createElement(ExplainBlock, { explain: m.explain }))))), /* @__PURE__ */ React.createElement("div", { className: "vg-chatform" }, /* @__PURE__ */ React.createElement(
      FormField,
      {
        placeholder: "Ask about your portfolio\u2026",
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        id: docked ? "chat-input-dock" : "chat-input"
      }
    ), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: send }, "Send")), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "0 16px 12px", margin: 0 } }, useMira ? "Mira AI assistant \u2014 canned demo replies when offline \xB7 educational only." : "Demo assistant with canned responses \xB7 educational only."));
    if (docked) return /* @__PURE__ */ React.createElement("div", { className: "vg-chatdock" }, inner);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-scrim", onClick: onClose }), /* @__PURE__ */ React.createElement("div", { className: "vg-panel" }, inner));
  }
  function ExplainBlock({ explain }) {
    if (explain === void 0) return /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, "loading trace\u2026");
    if (!explain) return /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, "no trace available");
    const claims = Array.isArray(explain.claims) ? explain.claims : [];
    const steps = Array.isArray(explain.plan_steps) ? explain.plan_steps.length : 0;
    const u = explain.uncertainty || {};
    const ratio = typeof u.grounded_ratio === "number" ? u.grounded_ratio : null;
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--color-border)", fontSize: 12, lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 11.5, marginBottom: 4 } }, ratio != null && /* @__PURE__ */ React.createElement(React.Fragment, null, "grounded ", Math.round(ratio * 100), "% \xB7 "), steps, " plan step", steps === 1 ? "" : "s", " \xB7 ", claims.length, " claim", claims.length === 1 ? "" : "s"), claims.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i }, "\xB7 ", c.statement, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", c.source_type, ":", c.source_id, ")"))));
  }
  function AccountsSettings() {
    const live_ = live_exports;
    const [rows, setRows] = useState8(null);
    const [busy, setBusy] = useState8("");
    const [err, setErr] = useState8("");
    const [adding, setAdding] = useState8(false);
    const [editId, setEditId] = useState8(null);
    const blank = { id: "", name: "", currency: "USD", jurisdiction: "US", taxable: true, broker: "" };
    const [form, setForm] = useState8(blank);
    const load = async () => {
      try {
        const p = await live_.accounts();
        setRows(p && p.accounts || []);
      } catch {
        setRows([]);
      }
    };
    useEffect5(() => {
      load();
    }, []);
    const startAdd = () => {
      setForm(blank);
      setEditId(null);
      setAdding(true);
      setErr("");
    };
    const startEdit = (a) => {
      setForm({
        id: a.id,
        name: a.name || a.short || a.id,
        currency: a.currency || "USD",
        jurisdiction: a.jurisdiction || "US",
        taxable: a.taxable !== false,
        broker: a.broker || ""
      });
      setEditId(a.id);
      setAdding(true);
      setErr("");
    };
    const save = async () => {
      setErr("");
      setBusy("save");
      try {
        if (editId) {
          await live_.editAccount(editId, {
            name: form.name,
            currency: form.currency,
            jurisdiction: form.jurisdiction,
            taxable: form.taxable,
            broker: form.broker
          });
        } else {
          if (!form.id.trim() || !form.name.trim()) {
            setErr("id and name are required");
            setBusy("");
            return;
          }
          const r = await live_.createAccount(form);
          if (r && r.error) {
            setErr(r.error);
            setBusy("");
            return;
          }
        }
        setAdding(false);
        await load();
      } catch (e) {
        setErr(String(e.message || e));
      }
      setBusy("");
    };
    const remove = async (id) => {
      if (!window.confirm(`Remove account "${id}" and its lots? This cannot be undone.`)) return;
      setBusy("del:" + id);
      try {
        await live_.deleteAccount(id);
        await load();
      } catch (e) {
        setErr(String(e.message || e));
      }
      setBusy("");
    };
    const sync = async (id) => {
      setBusy("sync:" + id);
      setErr("");
      try {
        const r = await live_.syncAccount(id);
        const res = r && r.results && r.results[0] || {};
        if (res.errors && res.errors.length) setErr(`${id}: ${res.errors.join("; ")}`);
        await load();
      } catch (e) {
        setErr(String(e.message || e));
      }
      setBusy("");
    };
    const authOk = (st) => !!st && /valid|present|grant/i.test(st);
    const reauth = async (id) => {
      setBusy("auth:" + id);
      setErr("");
      try {
        const r = await live_.kiteLoginUrl();
        if (r && r.error) {
          setErr(r.error);
          setBusy("");
          return;
        }
        const win = window.open(r.login_url, "kite-auth", "width=480,height=640");
        let tries = 0;
        const timer = setInterval(async () => {
          tries += 1;
          const p2 = await live_.accounts().catch(() => null);
          if (p2 && p2.accounts) {
            setRows(p2.accounts);
            const a = p2.accounts.find((x) => x.id === id);
            if (authOk(a && a.auth_status)) {
              clearInterval(timer);
              setBusy("");
              return;
            }
          }
          if (win && win.closed && tries > 1 || tries > 40) {
            clearInterval(timer);
            setBusy("");
          }
        }, 3e3);
      } catch (e) {
        setErr(String(e.message || e));
        setBusy("");
      }
    };
    if (rows === null) return /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "Loading accounts\u2026");
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", fontSize: 13 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "Account"), /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "Broker"), /* @__PURE__ */ React.createElement("th", null, "Ccy"), /* @__PURE__ */ React.createElement("th", null, "Juris."), /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "Status"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((a) => /* @__PURE__ */ React.createElement("tr", { key: a.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, a.short || a.id), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, a.id)), /* @__PURE__ */ React.createElement("td", null, a.broker || /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "manual")), /* @__PURE__ */ React.createElement("td", { className: "num" }, a.currency || "USD"), /* @__PURE__ */ React.createElement("td", { className: "num" }, a.jurisdiction || "US"), /* @__PURE__ */ React.createElement("td", null, a.auth_status ? /* @__PURE__ */ React.createElement("span", { className: authOk(a.auth_status) ? "vg-pos" : "vg-neg" }, a.auth_status) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right", whiteSpace: "nowrap" } }, a.broker === "zerodha" && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        disabled: busy === "auth:" + a.id,
        onClick: () => reauth(a.id)
      },
      busy === "auth:" + a.id ? "authorizing\u2026" : "Re-authenticate"
    ), a.refreshable && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        disabled: busy === "sync:" + a.id,
        onClick: () => sync(a.id)
      },
      busy === "sync:" + a.id ? "syncing\u2026" : "Sync"
    ), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => startEdit(a) }, "Edit"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn vg-neg",
        disabled: busy === "del:" + a.id,
        onClick: () => remove(a.id)
      },
      "Remove"
    )))), rows.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, className: "vg-note" }, "No accounts yet.")))), rows.some((a) => a.auth_hint) && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 8, fontSize: 12 } }, "API brokers need a one-time host-side auth (your secret never enters the browser). Run:", /* @__PURE__ */ React.createElement("ul", { style: { margin: "4px 0 0 0", paddingLeft: 18 } }, [...new Set(rows.filter((a) => a.auth_hint).map((a) => a.auth_hint))].map((h) => /* @__PURE__ */ React.createElement("li", { key: h }, /* @__PURE__ */ React.createElement("code", { style: { fontSize: 11 } }, h))))), !adding && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(Button, { variant: "outline", onClick: startAdd }, "+ Add account")), adding && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, padding: 12, border: "1px solid var(--border, #ddd)", borderRadius: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, editId ? `Edit ${editId}` : "New account"), !editId && /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Account id (short, unique)",
        id: "acc-id",
        value: form.id,
        onChange: (e) => setForm({ ...form, id: e.target.value.trim() })
      }
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Display name",
        id: "acc-name",
        value: form.name,
        onChange: (e) => setForm({ ...form, name: e.target.value })
      }
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        as: "select",
        label: "Currency",
        id: "acc-ccy",
        value: form.currency,
        onChange: (e) => setForm({ ...form, currency: e.target.value })
      },
      ["USD", "INR", "GBP", "EUR", "CAD", "HKD", "JPY", "AUD"].map((c) => /* @__PURE__ */ React.createElement("option", { key: c, value: c }, c))
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        as: "select",
        label: "Tax jurisdiction",
        id: "acc-juris",
        value: form.jurisdiction,
        onChange: (e) => setForm({ ...form, jurisdiction: e.target.value })
      },
      ["US", "IN", "GB", "CA", "HK", "JP", "AU", "EU"].map((c) => /* @__PURE__ */ React.createElement("option", { key: c, value: c }, c))
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        as: "select",
        label: "Broker (live sync; manual = CSV/none)",
        id: "acc-broker",
        value: form.broker,
        onChange: (e) => setForm({ ...form, broker: e.target.value })
      },
      /* @__PURE__ */ React.createElement("option", { value: "" }, "manual"),
      /* @__PURE__ */ React.createElement("option", { value: "zerodha" }, "Zerodha (Kite)"),
      /* @__PURE__ */ React.createElement("option", { value: "robinhood" }, "Robinhood")
    ), /* @__PURE__ */ React.createElement("label", { className: "vg-check", style: { display: "block", margin: "8px 0" } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: form.taxable,
        onChange: (e) => setForm({ ...form, taxable: e.target.checked })
      }
    ), " Taxable account"), err && /* @__PURE__ */ React.createElement("div", { className: "vg-neg", style: { fontSize: 12, marginBottom: 8 } }, err), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "flex-end", gap: 8 } }, /* @__PURE__ */ React.createElement(Button, { variant: "outline", onClick: () => setAdding(false) }, "Cancel"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", disabled: busy === "save", onClick: save }, busy === "save" ? "Saving\u2026" : editId ? "Save changes" : "Create account"))), err && !adding && /* @__PURE__ */ React.createElement("div", { className: "vg-neg", style: { fontSize: 12, marginTop: 8 } }, err));
  }
  function SettingsModal({ settings, accounts: accounts2 = [], onSave, onClose }) {
    const [draft, setDraft] = useState8(settings);
    return /* @__PURE__ */ React.createElement(Modal, { title: "Settings", open: true, onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Accounts"), /* @__PURE__ */ React.createElement(AccountsSettings, null), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 16 } }, "Preferences"), /* @__PURE__ */ React.createElement(
      FormField,
      {
        as: "select",
        label: "Default view",
        id: "set-acct",
        value: draft.defaultAccount,
        onChange: (e) => setDraft({ ...draft, defaultAccount: e.target.value })
      },
      /* @__PURE__ */ React.createElement("option", { value: "all" }, "All accounts"),
      accounts2.map((a) => /* @__PURE__ */ React.createElement("option", { key: a.id, value: a.id }, a.short || a.id))
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Harvest threshold ($ loss per lot)",
        type: "number",
        id: "set-usd",
        value: String(draft.thresholdUsd),
        onChange: (e) => setDraft({ ...draft, thresholdUsd: Number(e.target.value) || 0 })
      }
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Harvest threshold (% loss)",
        type: "number",
        id: "set-pct",
        value: String(draft.thresholdPct),
        onChange: (e) => setDraft({ ...draft, thresholdPct: Number(e.target.value) || 0 })
      }
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Marginal tax rate (%) \u2014 used for benefit estimates",
        type: "number",
        id: "set-tax",
        value: String(draft.taxRate),
        onChange: (e) => setDraft({ ...draft, taxRate: Number(e.target.value) || 0 })
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 16 } }, "Mira / AI"), /* @__PURE__ */ React.createElement(
      FormField,
      {
        as: "select",
        label: "AI assistant",
        id: "set-ai",
        value: draft.aiBackend,
        onChange: (e) => setDraft({ ...draft, aiBackend: e.target.value })
      },
      /* @__PURE__ */ React.createElement("option", { value: "mira" }, "Mira (live when reachable, canned fallback)"),
      /* @__PURE__ */ React.createElement("option", { value: "off" }, "Off \u2014 canned demo replies only")
    ), /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Mira URL",
        id: "set-mira-url",
        value: draft.miraUrl,
        onChange: (e) => setDraft({ ...draft, miraUrl: e.target.value.trim() })
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 16 } }, "Backend"), /* @__PURE__ */ React.createElement(
      FormField,
      {
        label: "Backend URL (portfolio API)",
        id: "set-backend-url",
        value: draft.backendUrl,
        onChange: (e) => setDraft({ ...draft, backendUrl: e.target.value.trim() })
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginTop: 16, justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(Button, { variant: "outline", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: () => onSave(draft) }, "Save")));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
