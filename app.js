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
  function StatTile({ label, value, delta, deltaDir, note, tone }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, label), /* @__PURE__ */ React.createElement("div", { className: cls("val", tone) }, value), delta != null && /* @__PURE__ */ React.createElement("div", { className: cls("delta", deltaDir) }, delta), note && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, note));
  }
  function LoadBar({ on = true }) {
    return on ? /* @__PURE__ */ React.createElement("div", { className: "vg-loadbar", role: "progressbar", "aria-label": "Loading" }) : null;
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

  // src/icons.jsx
  var P = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };
  var GLYPHS = {
    home: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M3 8.2 8 3.6l5 4.6V13H3V8.2z" }), /* @__PURE__ */ React.createElement("path", { d: "M6.5 13V9.8h3V13" })),
    today: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "4.4" }), /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "0.9", fill: "currentColor", stroke: "none" }), /* @__PURE__ */ React.createElement("path", { d: "M8 1.6v1.9M8 12.5v1.9M1.6 8h1.9M12.5 8h1.9" })),
    plan: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("rect", { x: "3.2", y: "2.4", width: "9.6", height: "11.2", rx: "1" }), /* @__PURE__ */ React.createElement("path", { d: "M5.5 5.6h5M5.5 8h5M5.5 10.4h3" })),
    scanner: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M2.6 8a5.4 5.4 0 1 1 5.4 5.4" }), /* @__PURE__ */ React.createElement("path", { d: "M8 8l3.6-3.6" }), /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "0.9", fill: "currentColor", stroke: "none" })),
    chart: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M5 4.4v7.2M5 5.8h-1.6v3.4H5M5 5.8h1.6v3.4H5" }), /* @__PURE__ */ React.createElement("path", { d: "M11 3v7.2M11 4.6H9.4v3.6H11M11 4.6h1.6v3.6H11", transform: "translate(0 1.6)" })),
    dashboard: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("rect", { x: "2.8", y: "2.8", width: "4.4", height: "4.4", rx: "0.8" }), /* @__PURE__ */ React.createElement("rect", { x: "8.8", y: "2.8", width: "4.4", height: "4.4", rx: "0.8" }), /* @__PURE__ */ React.createElement("rect", { x: "2.8", y: "8.8", width: "4.4", height: "4.4", rx: "0.8" }), /* @__PURE__ */ React.createElement("rect", { x: "8.8", y: "8.8", width: "4.4", height: "4.4", rx: "0.8" })),
    portfolio: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "5.4" }), /* @__PURE__ */ React.createElement("path", { d: "M8 2.6V8l3.9 3.7" })),
    positions: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M5 4.2h8M5 8h8M5 11.8h8" }), /* @__PURE__ */ React.createElement("circle", { cx: "2.9", cy: "4.2", r: "0.8", fill: "currentColor", stroke: "none" }), /* @__PURE__ */ React.createElement("circle", { cx: "2.9", cy: "8", r: "0.8", fill: "currentColor", stroke: "none" }), /* @__PURE__ */ React.createElement("circle", { cx: "2.9", cy: "11.8", r: "0.8", fill: "currentColor", stroke: "none" })),
    options: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("circle", { cx: "6.2", cy: "8", r: "3.6" }), /* @__PURE__ */ React.createElement("circle", { cx: "9.8", cy: "8", r: "3.6" })),
    tax: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M4 12L12 4" }), /* @__PURE__ */ React.createElement("circle", { cx: "4.9", cy: "4.9", r: "1.6" }), /* @__PURE__ */ React.createElement("circle", { cx: "11.1", cy: "11.1", r: "1.6" })),
    journal: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M8 3.4C6.8 2.6 4.8 2.4 3 2.8v10c1.8-.4 3.8-.2 5 .6 1.2-.8 3.2-1 5-.6v-10c-1.8-.4-3.8-.2-5 .6z" }), /* @__PURE__ */ React.createElement("path", { d: "M8 3.4v10" })),
    performance: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M3 13h10" }), /* @__PURE__ */ React.createElement("path", { d: "M4.6 13V9.4M8 13V6M11.4 13V3.6" })),
    futures: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("path", { d: "M2.8 4.6l3.4 3.2 2.4-2.2 4.6 4.6" }), /* @__PURE__ */ React.createElement("path", { d: "M13.2 7.4v2.8h-2.8" })),
    strategies: /* @__PURE__ */ React.createElement("g", { ...P }, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "3.8", r: "1.7" }), /* @__PURE__ */ React.createElement("circle", { cx: "4", cy: "12", r: "1.7" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "1.7" }), /* @__PURE__ */ React.createElement("path", { d: "M7.2 5.4L4.7 10.5M8.8 5.4l2.5 5.1" }))
  };
  function Icon({ name, size = 15 }) {
    const g = GLYPHS[name];
    if (!g) return null;
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        "aria-hidden": "true",
        style: { display: "block" }
      },
      g
    );
  }

  // src/live.js
  var live_exports = {};
  __export(live_exports, {
    accounts: () => accounts,
    addScannerTicker: () => addScannerTicker,
    allocation: () => allocation,
    analyzeSymbol: () => analyzeSymbol,
    botPoll: () => botPoll,
    buildForecastPrompt: () => buildForecastPrompt,
    calibrateReplay: () => calibrateReplay,
    closePaperTrade: () => closePaperTrade,
    createAccount: () => createAccount,
    deleteAccount: () => deleteAccount,
    deleteDrawing: () => deleteDrawing,
    deleteJournal: () => deleteJournal,
    disarmExit: () => disarmExit,
    editAccount: () => editAccount,
    ensureTodayJournal: () => ensureTodayJournal,
    executeTicket: () => executeTicket,
    exitsTick: () => exitsTick,
    getAnalysis: () => getAnalysis,
    getAnalyzedKeys: () => getAnalyzedKeys,
    getBars: () => getBars,
    getBarsOverlay: () => getBarsOverlay,
    getBotPerformance: () => getBotPerformance,
    getBotStatus: () => getBotStatus,
    getChart: () => getChart,
    getChartForecast: () => getChartForecast,
    getCoachPine: () => getCoachPine,
    getCoachTone: () => getCoachTone,
    getDayPnl: () => getDayPnl,
    getDayReviewBundle: () => getDayReviewBundle,
    getDayReviews: () => getDayReviews,
    getDrawings: () => getDrawings,
    getEntryStructure: () => getEntryStructure,
    getExits: () => getExits,
    getExplanation: () => getExplanation,
    getFuturesAnalysis: () => getFuturesAnalysis,
    getHistory: () => getHistory,
    getJournal: () => getJournal,
    getJournalAnalyses: () => getJournalAnalyses,
    getJournalAnalysisBundle: () => getJournalAnalysisBundle,
    getJson: () => getJson,
    getLayers: () => getLayers,
    getLifecycle: () => getLifecycle,
    getNightlyStatus: () => getNightlyStatus,
    getNotebook: () => getNotebook,
    getOdteRead: () => getOdteRead,
    getPaper: () => getPaper,
    getPlaybook: () => getPlaybook,
    getPlaybookPine: () => getPlaybookPine,
    getPosition: () => getPosition,
    getReclaimPine: () => getReclaimPine,
    getReplay: () => getReplay,
    getReplayRun: () => getReplayRun,
    getReplayRuns: () => getReplayRuns,
    getReplays: () => getReplays,
    getRoundtrips: () => getRoundtrips,
    getScanner: () => getScanner,
    getSessionActivity: () => getSessionActivity,
    getSpreadBook: () => getSpreadBook,
    getSpxForecasts: () => getSpxForecasts,
    getSpxSnapshot: () => getSpxSnapshot,
    getStrategies: () => getStrategies,
    getStrategyAudit: () => getStrategyAudit,
    getTicket: () => getTicket,
    getTradeAnalyses: () => getTradeAnalyses,
    getTradeDna: () => getTradeDna,
    getTradeStats: () => getTradeStats,
    getTradeablePositions: () => getTradeablePositions,
    health: () => health,
    importFutures: () => importFutures,
    importPositions: () => importPositions,
    importTransactions: () => importTransactions,
    journalImageUrl: () => journalImageUrl,
    kiteLoginUrl: () => kiteLoginUrl,
    lifecycleTick: () => lifecycleTick,
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
    mapMarketBand: () => mapMarketBand,
    mapNews: () => mapNews,
    mapNotebook: () => mapNotebook,
    mapPlaybook: () => mapPlaybook,
    mapPositions: () => mapPositions,
    mapStrategies: () => mapStrategies,
    mapTlh: () => mapTlh,
    mapWash: () => mapWash,
    miraHealth: () => miraHealth,
    openPaperTrade: () => openPaperTrade,
    pauseStrategy: () => pauseStrategy,
    planReplay: () => planReplay,
    portfolioAnalyze: () => portfolioAnalyze,
    portfolioPerformance: () => portfolioPerformance,
    positions: () => positions,
    postJson: () => postJson,
    postNote: () => postNote,
    postPlan: () => postPlan,
    prepareSpx: () => prepareSpx,
    promoteStrategy: () => promoteStrategy,
    quotes: () => quotes,
    recomputePlaybook: () => recomputePlaybook,
    refreshAccount: () => refreshAccount,
    refreshAll: () => refreshAll,
    refreshChart: () => refreshChart,
    refreshScanner: () => refreshScanner,
    refreshSpx: () => refreshSpx,
    removeScannerTicker: () => removeScannerTicker,
    resumeStrategy: () => resumeStrategy,
    saveBotConfig: () => saveBotConfig,
    saveDayReview: () => saveDayReview,
    saveDrawing: () => saveDrawing,
    saveJournalAnalysis: () => saveJournalAnalysis,
    saveJournalEntry: () => saveJournalEntry,
    saveSpxForecast: () => saveSpxForecast,
    saveTradeAnalysis: () => saveTradeAnalysis,
    scoreJournal: () => scoreJournal,
    scoreReplay: () => scoreReplay,
    scoreSpxForecast: () => scoreSpxForecast,
    settlePaper: () => settlePaper,
    streamTurn: () => streamTurn,
    symbolThreadId: () => symbolThreadId,
    syncAccount: () => syncAccount,
    taxGains: () => taxGains,
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
  async function importCsv(kind, file, account, broker) {
    const base = backendBase();
    if (!base) return { available: false };
    const fd = new FormData();
    fd.append("file", file, file.name || `${kind}.csv`);
    fd.append("account", account);
    fd.append("broker", broker || "fidelity");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3e4);
    try {
      const res = await fetch(`${base}/api/import/${kind}`, {
        method: "POST",
        body: fd,
        signal: ctrl.signal
      });
      return res.ok ? await res.json() : { available: false, note: `HTTP ${res.status}` };
    } catch (e) {
      return { available: false, note: String(e && e.message || e) };
    } finally {
      clearTimeout(t);
    }
  }
  var importTransactions = (file, account, broker = "fidelity") => importCsv("transactions", file, account, broker);
  var importPositions = (file, account, broker = "fidelity") => importCsv("positions", file, account, broker);
  var kiteLoginUrl = () => getJson(`${backendBase()}/api/kite/login-url`);
  var refreshAccount = (accountId) => postJson(`${backendBase()}/api/refresh`, { account: accountId });
  var refreshAll = () => postJson(`${backendBase()}/api/refresh`, {});
  var positions = (account = "all") => getJson(`${backendBase()}/api/positions?account=${encodeURIComponent(account)}`);
  var allocation = (account = "all") => getJson(`${backendBase()}/api/allocation?account=${encodeURIComponent(account)}`);
  var portfolioAnalyze = (account = "all", currency = "") => getJson(`${backendBase()}/api/portfolio/analyze?account=${encodeURIComponent(account)}` + (currency ? `&currency=${encodeURIComponent(currency)}` : ""), { timeoutMs: 6e4 });
  var portfolioPerformance = (account = "all") => getJson(`${backendBase()}/api/portfolio/performance?account=${encodeURIComponent(account)}`);
  var lots = (account = "all") => getJson(`${backendBase()}/api/lots?account=${encodeURIComponent(account)}`);
  var wash = () => getJson(`${backendBase()}/api/tax/wash`);
  var taxGains = (account = "all", year) => {
    const q = new URLSearchParams({ account });
    if (year) q.set("year", year);
    return getJson(`${backendBase()}/api/tax/gains?${q}`, { timeoutMs: 2e4 });
  };
  var tlh = ({ thresholdUsd, thresholdPct } = {}) => {
    const q = new URLSearchParams();
    if (thresholdUsd != null) q.set("thresholdUsd", String(thresholdUsd));
    if (thresholdPct != null) q.set("thresholdPct", String(thresholdPct));
    const qs = q.toString();
    return getJson(`${backendBase()}/api/tax/tlh${qs ? `?${qs}` : ""}`);
  };
  var quotes = () => getJson(`${backendBase()}/api/quotes`);
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
        // array of account ids
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
    for (const line2 of frame.split("\n")) {
      if (line2.startsWith("event:")) kind = line2.slice(6).trim();
      else if (line2.startsWith("data:")) dataLines.push(line2.slice(5).trim());
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
  async function getReclaimPine(date, symbol = "SPX") {
    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
    const q = params.length ? `?${params.join("&")}` : "";
    const v = await getJson(`${backendBase()}/api/spx/reclaim/pine${q}`, { timeoutMs: 2e4 });
    if (v && v.available) {
      return {
        available: true,
        session: v.session,
        script: v.script,
        gexLevels: v.gex_levels,
        prefilled: v.prefilled
      };
    }
    return { available: false };
  }
  async function getCoachPine(date, symbol = "SPX") {
    const params = [];
    if (date) params.push(`date=${encodeURIComponent(date)}`);
    if (symbol && symbol !== "SPX") params.push(`symbol=${encodeURIComponent(symbol)}`);
    const q = params.length ? `?${params.join("&")}` : "";
    const v = await getJson(`${backendBase()}/api/spx/coach/pine${q}`, { timeoutMs: 2e4 });
    if (v && v.available) return { available: true, session: v.session, script: v.script };
    return { available: false };
  }
  async function getTicket(symbol, side, level, risk = 500, entry = null) {
    const q = `symbol=${encodeURIComponent(symbol)}&side=${encodeURIComponent(side)}&level=${encodeURIComponent(level)}&risk=${encodeURIComponent(risk)}` + (entry ? `&entry=${encodeURIComponent(entry)}` : "");
    const v = await getJson(`${backendBase()}/api/ticket?${q}`, { timeoutMs: 2e4 });
    if (v && v.available) return { available: true, ticket: v.ticket, text: v.text };
    return { available: false, note: v && v.note || "ticket unavailable" };
  }
  async function executeTicket(body) {
    const v = await postJson(
      `${backendBase()}/api/ticket/execute`,
      body,
      { timeoutMs: 6e4 }
    );
    if (!v) return { available: false, note: "backend unreachable" };
    return v;
  }
  async function getExits(status, { mergeBroker = false } = {}) {
    const p = [];
    if (status) p.push(`status=${encodeURIComponent(status)}`);
    if (mergeBroker) p.push("merge_broker=1");
    const q = p.length ? `?${p.join("&")}` : "";
    const v = await getJson(`${backendBase()}/api/exits${q}`);
    if (!v) return { positions: [], broker: [], live_gate: false, unreachable: true };
    return { positions: v.positions || [], broker: v.broker || [], live_gate: !!v.live_gate };
  }
  var exitsTick = () => postJson(`${backendBase()}/api/exits/tick`, {}, { timeoutMs: 6e4 });
  var disarmExit = (id) => postJson(`${backendBase()}/api/exits/${encodeURIComponent(id)}/disarm`, {});
  var getLifecycle = () => getJson(`${backendBase()}/api/lifecycle`);
  var promoteStrategy = (sid, body) => postJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/promote`, body);
  var pauseStrategy = (sid, body = {}) => postJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/pause`, body);
  var resumeStrategy = (sid) => postJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/resume`, {});
  var lifecycleTick = (live = false) => postJson(`${backendBase()}/api/lifecycle/tick`, { live }, { timeoutMs: 6e4 });
  var getStrategyAudit = (sid) => getJson(`${backendBase()}/api/lifecycle/${encodeURIComponent(sid)}/audit`);
  var getBotStatus = () => getJson(`${backendBase()}/api/reclaim-bot/status`);
  var saveBotConfig = (body) => postJson(`${backendBase()}/api/reclaim-bot/config`, body);
  var botPoll = () => postJson(`${backendBase()}/api/reclaim-bot/poll`, {}, { timeoutMs: 12e4 });
  var getBotPerformance = () => getJson(`${backendBase()}/api/reclaim-bot/performance`);
  var getNightlyStatus = (limit = 1) => getJson(`${backendBase()}/api/nightly/status?limit=${limit}`);
  var getSessionActivity = (day, underlying) => {
    const q = new URLSearchParams();
    if (day) q.set("day", day);
    if (underlying) q.set("underlying", underlying);
    return getJson(
      `${backendBase()}/api/journal/activity?${q.toString()}`,
      { timeoutMs: 2e4 }
    );
  };
  var getDayPnl = (days, underlying) => {
    const q = new URLSearchParams({ days: days.join(",") });
    if (underlying) q.set("underlying", underlying);
    return getJson(`${backendBase()}/api/journal/day-pnl?${q.toString()}`, { timeoutMs: 15e3 });
  };
  var getEntryStructure = (day, trade, underlying = "SPX") => getJson(`${backendBase()}/api/journal/entry-structure?day=${encodeURIComponent(day)}&trade=${trade}&underlying=${encodeURIComponent(underlying)}`, { timeoutMs: 2e4 });
  var getTradeDna = (day, trade, underlying = "SPX") => getJson(`${backendBase()}/api/journal/trade-dna?day=${encodeURIComponent(day)}&trade=${trade}&underlying=${encodeURIComponent(underlying)}`, { timeoutMs: 3e4 });
  var saveTradeAnalysis = (body) => postJson(`${backendBase()}/api/journal/trade-analysis`, body);
  var getJournalAnalysisBundle = (from, to, underlying = "SPX") => getJson(
    `${backendBase()}/api/journal/analysis/bundle?window_from=${encodeURIComponent(from)}&window_to=${encodeURIComponent(to)}&underlying=${encodeURIComponent(underlying)}`,
    { timeoutMs: 2e4 }
  );
  var saveJournalAnalysis = (body) => postJson(`${backendBase()}/api/journal/analysis`, body);
  var getCoachTone = (day, symbol = "SPX") => getJson(`${backendBase()}/api/coach/tone?symbol=${encodeURIComponent(symbol)}` + (day ? `&day=${encodeURIComponent(day)}` : ""), { timeoutMs: 3e4 });
  var getOdteRead = (underlying = "SPY") => getJson(
    `${backendBase()}/api/odte/read?underlying=${encodeURIComponent(underlying)}`,
    { timeoutMs: 3e4 }
  );
  var buildForecastPrompt = (symbol, ref) => `What will ${symbol} price do from here? Reason over the snapshot and give a structured, scoreable forecast (bias, expected path, level targets, invalidation, confidence).
DISCIPLINE (hard rules):
1. CITE the snapshot's regime + technicals VERBATIM (vs_vwap_pt, rsi, draw.dir). Never restate a relationship the numbers contradict.
2. If ict_htf.present is false, there IS NO hourly setup \u2014 you must not claim one or use its levels; say it was suppressed and why.
3. SANITY CHECK before answering: a down bias requires invalidation ABOVE current price; an up bias requires it BELOW. If your setup is already beyond its invalidation at current price, output bias "neutral" and say "stand down \u2014 no valid setup". Standing down is a first-class forecast.
4. Negative gamma amplifies BOTH directions \u2014 below-the-flip on a risk-on tape means faster moves UP toward the flip, not a short signal.
${ref}`;
  var getTradeAnalyses = (day) => getJson(`${backendBase()}/api/journal/trade-analyses?day=${encodeURIComponent(day)}`);
  var saveDayReview = (body) => postJson(`${backendBase()}/api/journal/day-review`, body);
  var getDayReviews = (day) => getJson(`${backendBase()}/api/journal/day-review?day=${encodeURIComponent(day)}`);
  var getAnalyzedKeys = (day) => getJson(`${backendBase()}/api/journal/analyzed-keys?day=${encodeURIComponent(day)}`);
  var getDayReviewBundle = (day, underlying = "SPX") => getJson(`${backendBase()}/api/journal/day-review-bundle?day=${encodeURIComponent(day)}&underlying=${encodeURIComponent(underlying)}`, { timeoutMs: 18e4 });
  var getJournalAnalyses = (underlying = "SPX") => getJson(`${backendBase()}/api/journal/analysis?underlying=${encodeURIComponent(underlying)}`);
  var getChart = (symbol, tf = "5m", days = 15) => getJson(
    `${backendBase()}/api/chart/${encodeURIComponent(symbol)}?tf=${encodeURIComponent(tf)}&days=${days}`,
    { timeoutMs: 2e4 }
  );
  var refreshChart = (symbol, tf = "5m", days = 1) => postJson(
    `${backendBase()}/api/chart/${encodeURIComponent(symbol)}/refresh`,
    { tf, days },
    { timeoutMs: 6e4 }
  );
  var getDrawings = (symbol) => getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/drawings`);
  var saveDrawing = (symbol, drawing) => postJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/drawings`, drawing);
  var deleteDrawing = (symbol, id) => postJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/drawings`, { delete: id });
  var getLayers = (symbol) => getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/layers`, { timeoutMs: 2e4 });
  var getPosition = (symbol) => getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/position`, { timeoutMs: 15e3 });
  var getChartForecast = (symbol) => getJson(`${backendBase()}/api/chart/${encodeURIComponent(symbol)}/forecast`, { timeoutMs: 2e4 });
  var getReplayRuns = (limit = 40) => getJson(`${backendBase()}/api/replay/runs?limit=${limit}`, { timeoutMs: 2e4 });
  var getReplayRun = (runId) => getJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}`, { timeoutMs: 2e4 });
  var getSpxSnapshot = (day, asOf, symbol = "SPX") => getJson(`${backendBase()}/api/spx/snapshot?symbol=${encodeURIComponent(symbol)}` + (day ? `&day=${encodeURIComponent(day)}` : "") + (asOf ? `&as_of=${encodeURIComponent(asOf)}` : ""));
  var saveSpxForecast = (body) => postJson(`${backendBase()}/api/spx/forecast`, body);
  var getSpxForecasts = (day, symbol = "SPX", limit = 50) => getJson(`${backendBase()}/api/spx/forecast?symbol=${encodeURIComponent(symbol)}` + (day ? `&day=${encodeURIComponent(day)}` : "") + `&limit=${limit}`);
  var scoreSpxForecast = (fid) => postJson(`${backendBase()}/api/spx/forecast/${fid}/score`, {});
  var prepareSpx = (symbol, days = 5) => postJson(`${backendBase()}/api/spx/prepare`, { symbol, days });
  var refreshSpx = (symbol) => postJson(`${backendBase()}/api/spx/refresh`, { symbol });
  var getScanner = (scanner = "ict_htf") => getJson(
    `${backendBase()}/api/scanner?scanner=${encodeURIComponent(scanner)}`,
    { timeoutMs: 2e4 }
  );
  var refreshScanner = (scanner = "ict_htf", refreshUniverse = false) => postJson(
    `${backendBase()}/api/scanner/refresh`,
    { scanner, refresh_universe: refreshUniverse },
    { timeoutMs: 2e4 }
  );
  var addScannerTicker = (sym) => postJson(`${backendBase()}/api/scanner/tickers`, { add: sym }, { timeoutMs: 3e4 });
  var removeScannerTicker = (sym) => postJson(`${backendBase()}/api/scanner/tickers`, { remove: sym }, { timeoutMs: 3e4 });
  var planReplay = (day, symbol = "SPX", premarket = false, stepMin = 15) => postJson(
    `${backendBase()}/api/replay/plan`,
    { day, symbol, premarket, step_min: stepMin },
    { timeoutMs: 6e4 }
  );
  var getReplays = (limit = 40) => getJson(`${backendBase()}/api/replay/runs?limit=${limit}`, { timeoutMs: 2e4 });
  var getReplay = (runId) => getJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}`, { timeoutMs: 2e4 });
  var scoreReplay = (runId) => postJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}/score`, {});
  var calibrateReplay = (runId, body = {}) => postJson(`${backendBase()}/api/replay/${encodeURIComponent(runId)}/calibration`, body);
  var getTradeablePositions = () => getJson(`${backendBase()}/api/positions/tradeable`);
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
      // sector rotation (market_context) — ranked by 20d return for the Market context card
      sectors: Array.isArray(s.sectors) ? s.sectors : [],
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
  async function getSpreadBook() {
    const v = await getJson(`${backendBase()}/api/paper/spreads`, { timeoutMs: 3e4 });
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
    const [loading, setLoading] = React.useState(true);
    const everLive = React.useRef(false);
    React.useEffect(() => {
      let alive = true;
      setLiveData(null);
      setLoading(true);
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
      }).finally(() => {
        if (alive) setLoading(false);
      });
      return () => {
        alive = false;
      };
    }, deps);
    if (liveData != null) return { data: liveData, isLive: true, outage: false, loading };
    const blanked = blankOnOutage && outage;
    const fb = blanked ? Array.isArray(fallback) ? [] : null : fallback;
    return { data: fb, isLive: false, outage: blanked, loading };
  }

  // src/tone_card.jsx
  var { useState, useEffect } = React;
  var money2 = (v) => v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}$${Math.abs(Number(v)).toFixed(0)}`;
  function ToneCompareCard({ marketOpen, day, slim }) {
    const [tick, setTick] = useState(0);
    useEffect(() => {
      if (!marketOpen) return void 0;
      const t = setInterval(() => setTick((n) => n + 1), 18e4);
      return () => clearInterval(t);
    }, [marketOpen]);
    const q = useLive(() => getCoachTone(day), null, [tick, day]);
    const d = q.data && q.data.available ? q.data : null;
    if (!d || !(d.buckets || []).length) return null;
    const SLOTS = 26;
    const slotOf = (startMin) => Math.max(0, Math.min(SLOTS - 1, Math.floor((startMin - 570) / 15)));
    const market = new Array(SLOTS).fill(null);
    for (const b of d.buckets) market[slotOf(b.start_min)] = b;
    const tradeSlots = new Array(SLOTS).fill(null).map(() => []);
    for (const t of d.trades || []) {
      if (t.start_min >= 570 && t.start_min < 960) tradeSlots[slotOf(t.start_min)].push(t);
    }
    const toneColor = (tn) => tn === "bull" ? "var(--vg-up)" : tn === "bear" ? "var(--vg-down)" : "var(--vg-hairline)";
    const al = d.alignment || {};
    const last = d.buckets[d.buckets.length - 1];
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", flexWrap: "wrap", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Market tone vs your trades", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " ", "\u2014 15-min snapshots", d.gap_pct != null ? ` \xB7 gap ${d.gap_pct > 0 ? "+" : ""}${d.gap_pct}%` : "", last ? ` \xB7 session ${last.session_tone.toUpperCase()} (${last.session_ret_pct > 0 ? "+" : ""}${last.session_ret_pct}%)` : "")), (al.with || al.against) && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontVariantNumeric: "tabular-nums" } }, "with-trend ", /* @__PURE__ */ React.createElement("b", { className: al.with.pnl >= 0 ? "vg-up" : "vg-down" }, al.with.n, " \xB7 ", money2(al.with.pnl)), "  \xB7  ", "against ", /* @__PURE__ */ React.createElement("b", { className: al.against.pnl >= 0 ? "vg-up" : "vg-down" }, al.against.n, " \xB7 ", money2(al.against.pnl)))), /* @__PURE__ */ React.createElement("div", { className: "vg-tone-grid", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-tone-lbl" }, "market"), market.map((b, i) => /* @__PURE__ */ React.createElement(
      "span",
      {
        key: i,
        className: "vg-tone-cell",
        title: b ? `${b.t} \xB7 ${b.tone} (${b.ret_pct > 0 ? "+" : ""}${b.ret_pct}%) \xB7 session ${b.session_tone}` : "",
        style: {
          background: b ? toneColor(b.tone) : "transparent",
          opacity: b ? b.tone === "flat" ? 0.5 : 0.9 : 0.15,
          border: b ? "none" : "1px dashed var(--vg-hairline)"
        }
      }
    )), /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-tone-lbl" }, "you"), tradeSlots.map((ts, i) => /* @__PURE__ */ React.createElement("span", { key: i, className: "vg-tone-cell vg-tone-tradecell" }, ts.map((t, j) => /* @__PURE__ */ React.createElement(
      "span",
      {
        key: j,
        className: "vg-tone-dot",
        title: `${t.time} ${t.label} \xB7 ${t.dir}${t.with_trend == null ? "" : t.with_trend ? " \xB7 WITH trend" : " \xB7 AGAINST trend"}${t.realized != null ? ` \xB7 ${money2(t.realized)}` : " \xB7 open"}`,
        style: {
          background: t.dir === "bullish" ? "var(--vg-up)" : "var(--vg-down)",
          boxShadow: t.with_trend === false ? "0 0 0 2px var(--vg-warn)" : "none"
        }
      }
    ))))), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 6, fontSize: "var(--vg-text-xs)" } }, "dot = your entry (green long \xB7 red short) \xB7 amber ring = against the session tone at entry"), d.verdict && !slim && /* @__PURE__ */ React.createElement("div", { className: "vg-tone-verdict" }, "\u26A0 ", d.verdict), (d.commentary || []).length > 0 && !slim && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, d.commentary.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-tone-note" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-tone-notedot", c.tone) }), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: {
      fontSize: "var(--vg-text-sm)",
      color: c.tone === "bad" ? "var(--vg-down)" : void 0
    } }, c.text)))));
  }

  // src/ops_cards.jsx
  var { useState: useState2, useEffect: useEffect2 } = React;
  var fmt = (v, d = 2) => v == null ? "\u2014" : Number(v).toFixed(d);
  var money3 = (v) => v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}$${Math.abs(Number(v)).toFixed(0)}`;
  function SignalsCard({ live, armed, spot, onExecute }) {
    const n = live.length;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Signals \xB7 ", n, " confirmed", armed.length ? `, ${armed.length} waiting` : "")), n === 0 && armed.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 12 } }, "Nothing armed yet \u2014 the bot arms each session's playbook levels at its next pass."), live.map((t) => /* @__PURE__ */ React.createElement(SignalRow, { key: t.id, t, onExecute })), armed.map((t) => /* @__PURE__ */ React.createElement(SignalRow, { key: t.id, t, armed: true })));
  }
  function SignalRow({ t, armed, onExecute }) {
    const long = t.side === "long";
    const risk = t.spy_entry != null && t.spy_stop != null ? Math.abs(t.spy_entry - t.spy_stop) * (t.shares || 100) : null;
    const reward = t.spy_target != null && t.spy_entry != null ? long ? t.spy_target - t.spy_entry : t.spy_entry - t.spy_target : null;
    const rr = reward != null && t.spy_stop != null && t.spy_entry != null ? reward / Math.abs(t.spy_entry - t.spy_stop) : null;
    const badEdge = !armed && rr != null && rr < 1;
    return /* @__PURE__ */ React.createElement("div", { className: cls("vg-sigrow", armed && "armed", !armed && (long ? "live-long" : "live-short")) }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, armed ? "\u25CB" : "\u{1F514}"), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 650, letterSpacing: "-.01em" } }, /* @__PURE__ */ React.createElement("span", { className: long ? "vg-up" : "vg-down" }, t.side.toUpperCase()), " ", t.symbol, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, armed ? `armed at ${fmt(t.spy_level)}` : `${long ? "reclaimed" : "rejected"} ${fmt(t.spy_level)}`)), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 3, fontVariantNumeric: "tabular-nums" } }, armed ? /* @__PURE__ */ React.createElement(React.Fragment, null, "waiting for the 3\xD75m reclaim \xB7 stop ", fmt(t.spy_stop), " \xB7 target ", fmt(t.spy_target)) : /* @__PURE__ */ React.createElement(React.Fragment, null, "entry ", /* @__PURE__ */ React.createElement("b", null, fmt(t.spy_entry)), " \xB7 stop ", /* @__PURE__ */ React.createElement("b", null, fmt(t.spy_stop)), " \xB7", " ", t.spy_target != null ? /* @__PURE__ */ React.createElement(React.Fragment, null, "target ", /* @__PURE__ */ React.createElement("b", null, fmt(t.spy_target))) : /* @__PURE__ */ React.createElement("span", { className: "vg-warn-text" }, "no target \u2014 open-ended"), risk != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 risk ", /* @__PURE__ */ React.createElement("b", null, "$", risk.toFixed(0))), rr != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 R:R ", /* @__PURE__ */ React.createElement("b", { className: badEdge ? "vg-down" : void 0 }, rr.toFixed(2))))), badEdge && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4, color: "var(--vg-down)", fontWeight: 600 } }, "\u26A0\uFE0F negative edge \u2014 the target is nearer than the stop. Not executable.")), armed ? /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: true, style: { opacity: 0.45 } }, "Waiting") : badEdge ? /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        disabled: true,
        style: { opacity: 0.45 },
        title: "refused: R:R below 1 \u2014 the execute path would reject this"
      },
      "Blocked"
    ) : /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm vg-btn-primary", onClick: () => onExecute(t) }, "Execute"));
  }
  function StrategyCard({ perf }) {
    const s = perf && perf.summary || null;
    if (!s) return /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Is the strategy working?"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10 } }, "No closed signals yet."));
    const losing = s.paper_pnl < 0;
    const thin = s.paper_closed < 20;
    return /* @__PURE__ */ React.createElement("div", { className: cls("vg-card", losing && "vg-card-alarm") }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Is the strategy working?"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 22, marginTop: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
      Metric,
      {
        label: "win rate",
        bad: losing,
        value: s.paper_win_rate == null ? "\u2014" : `${Math.round(s.paper_win_rate * 100)}%`
      }
    ), /* @__PURE__ */ React.createElement(Metric, { label: "net P&L", bad: losing, value: money3(s.paper_pnl) }), /* @__PURE__ */ React.createElement(Metric, { label: "closed", value: String(s.paper_closed) })), losing && /* @__PURE__ */ React.createElement("p", { className: "vg-verdict" }, "\u26A0\uFE0F Losing money over ", s.paper_closed, " trades.", thin ? " Small sample \u2014 but do not size up." : " Stop and re-validate before taking more."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, fontSize: 12 } }, "The bot's OWN trades, every underlying, losses included.", s.live_taken > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, " Live: ", s.live_taken, " taken \xB7 ", money3(s.live_pnl), ".")));
  }
  function MachineCard({ run }) {
    if (!run) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Is the machine OK?"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10 } }, "No nightly run recorded yet."));
    }
    const jobs = run.jobs || [];
    const bad = jobs.filter((j) => !j.ok);
    const total = jobs.reduce((a, j) => a + (j.duration_sec || 0), 0);
    return /* @__PURE__ */ React.createElement("div", { className: cls("vg-card", bad.length && "vg-card-alarm") }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Is the machine OK?"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 22, marginTop: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(Metric, { label: "jobs ok", value: `${jobs.length - bad.length}\u2713` }), /* @__PURE__ */ React.createElement(Metric, { label: "failed", value: `${bad.length}\u2717`, bad: bad.length > 0 }), /* @__PURE__ */ React.createElement(Metric, { label: "runtime", value: total >= 60 ? `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s` : `${total}s` })), bad.map((j, i) => /* @__PURE__ */ React.createElement("p", { key: i, className: "vg-note", style: { marginTop: 6, color: "var(--vg-down)" } }, "\u2717 ", /* @__PURE__ */ React.createElement("b", null, j.job), " \u2014 ", (j.tail || "").split("\n").slice(-1)[0].slice(0, 60))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, fontSize: 12 } }, "last run ", String(run.started_at || "").slice(0, 16).replace("T", " ")));
  }
  function Metric({ label, value, bad }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 20,
      fontWeight: 650,
      letterSpacing: "-.01em",
      fontVariantNumeric: "tabular-nums",
      color: bad ? "var(--vg-down)" : void 0
    } }, value), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" } }, label));
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
    return /* @__PURE__ */ React.createElement("details", { className: "vg-card" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, title), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8, marginTop: 8 } }, items.map((g, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { fontSize: 14, lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("b", null, g.label), " \u2014 ", g.long))));
  }

  // src/playbook.jsx
  var { useMemo, useState: useState3, useEffect: useEffect3 } = React;
  var fmtP = (v) => v == null ? "\u2014" : Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
  function levelTone(kind) {
    const k = (kind || "").toLowerCase();
    if (k.includes("resistance") || k.includes("call wall")) return "bad";
    if (k.includes("support") || k.includes("put wall")) return "good";
    if (k.includes("flip") || k.includes("pin") || k.includes("pain")) return "warn";
    return "plain";
  }
  function PlanHalf({ refreshNonce }) {
    const [nonce, setNonce] = useState3(0);
    const [sym, setSym] = useState3("SPX");
    const [pine, setPine] = useState3(null);
    const [busy, setBusy] = useState3(false);
    const [ticket, setTicket] = useState3(null);
    const [alerts, setAlerts] = useState3([]);
    const backendUrl = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl || "http://127.0.0.1:8641").replace(/\/+$/, "");
    const loadAlerts = () => fetch(`${backendUrl()}/api/alerts`).then((r) => r.json()).then((r) => setAlerts(r && r.alerts || [])).catch(() => {
    });
    useEffect3(() => {
      loadAlerts();
    }, []);
    const armAlert = async (price, note) => {
      await fetch(`${backendUrl()}/api/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: sym, price, note })
      }).catch(() => {
      });
      loadAlerts();
    };
    const dropAlert = async (id) => {
      await fetch(`${backendUrl()}/api/alerts/${id}`, { method: "DELETE" }).catch(() => {
      });
      loadAlerts();
    };
    const alertAt = (price) => alerts.find((a) => a.symbol === sym && !a.fired_at && Math.abs(a.price - price) < 0.01);
    const [didRecompute, setDidRecompute] = useState3(false);
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
    const liveQ = useLive(() => getChart(sym, "1m", 2), null, [sym, nonce]);
    const liveCandles = liveQ.data && liveQ.data.available && liveQ.data.candles || [];
    const liveClose = liveCandles.length ? liveCandles[liveCandles.length - 1].close : null;
    const drift = liveClose != null && spot != null ? Math.abs(liveClose - spot) : null;
    const keyLevels = useMemo(() => {
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
      return /* @__PURE__ */ React.createElement("div", { className: "vg-playbook", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("h2", { style: { margin: "0 0 6px", fontSize: 19 } }, "0DTE SPX Playbook"), /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "No playbook generated yet. Run ", /* @__PURE__ */ React.createElement("code", null, "python -m vantage_server.spx_playbook"), " ", "(nightly, after Sentinel's GEX/zone snapshot). It fuses dealer-gamma, S/R, breadth/VIX, Fed/macro, and SPX chart structure into a daily read."));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "vg-playbook", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "0DTE ", sym, " Playbook"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 6, marginBottom: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement(SymbolSwitcher, { value: sym, onChange: setSym })), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, p ? `for ${p.session || "the next session"}` : "loading\u2026", reg.gamma ? ` \xB7 gamma ${reg.gamma}` : "", reg.vix != null ? ` \xB7 VIX ${fmtP(reg.vix)}${reg.vix_band ? ` (${reg.vix_band})` : ""}` : "", drift != null && drift > 15 && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { marginLeft: 8, fontSize: "var(--vg-text-xs)" } }, "plan written at ", fmtP(spot), " \u2014 ", drift.toFixed(0), "pt away \xB7 hit \u27F3 Refresh")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: exportPine }, "Export to Pine"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm vg-btn-primary",
        disabled: busy,
        onClick: recompute,
        title: "Rebuild levels + GEX from the latest data and re-narrate the read at the current price"
      },
      busy ? "Refreshing\u2026" : "\u27F3 Refresh plan"
    ))), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-levels" }, spot != null && /* @__PURE__ */ React.createElement(SummaryTile, { label: "Spot", value: fmtP(spot) }), /* @__PURE__ */ React.createElement(SummaryTile, { label: "Flip", value: fmtP(keyLevels.flip), tone: "warn" }), /* @__PURE__ */ React.createElement(SummaryTile, { label: "Put wall", value: fmtP(keyLevels.put), tone: "good" }), /* @__PURE__ */ React.createElement(SummaryTile, { label: "Call wall", value: fmtP(keyLevels.call), tone: "bad" }))), pine && /* @__PURE__ */ React.createElement(PineModal, { pine, session: p && p.session, onClose: () => setPine(null) }), ticket && /* @__PURE__ */ React.createElement(TicketModal, { sym, spot, seed: ticket, onClose: () => setTicket(null) }), cat.today && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-catalyst" }, "\u26A0\uFE0F Catalyst today: ", /* @__PURE__ */ React.createElement("b", null, cat.today), " \u2014 expect bigger moves; size down."), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today's read"), p && p.narrative ? (() => {
      const parsed = parseRead(p.narrative);
      return parsed ? /* @__PURE__ */ React.createElement(ReadCards, { parsed }) : /* @__PURE__ */ React.createElement("div", { className: "vg-pb-narrative", style: { whiteSpace: "pre-wrap" } }, p.narrative);
    })() : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, pb.loading ? "Generating the read\u2026" : "No narrative available."), p && p.structureNote && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 8, fontSize: 13 } }, /* @__PURE__ */ React.createElement("b", null, "Structure:"), " ", p.structureNote), p && p.volumeNote && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 2, fontSize: 13 } }, /* @__PURE__ */ React.createElement("b", null, "Volume:"), " ", p.volumeNote)), /* @__PURE__ */ React.createElement(VolReadCard, null), p && (reg.breadth_pct_above_50ma != null || reg.vix != null || reg.intermarket) && /* @__PURE__ */ React.createElement(MarketContextCard, { reg, sectors: p && p.sectors || [] }), p && p.durable && p.durable.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Durable levels \u2605 (memory)"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, margin: "2px 0 8px" } }, 'Levels the tape kept respecting across many sessions \u2014 the "traces back weeks" levels.'), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, p.durable.map((z, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn"),
        style: { minWidth: 62, textAlign: "right" }
      },
      fmtP(z.price)
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, z.kind || `durable ${z.role}`), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, z.sessions, "\xD7 sessions", z.respected ? ` \xB7 respected ${z.respected}` : ""))))), p && p.confluence && p.confluence.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Confluence zones \u2726"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, margin: "2px 0 8px" } }, "Bands where 2+ dimensions (GEX wall / fib / PoC / S-R) line up \u2014 the high-signal levels."), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, p.confluence.map((z, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn"),
        style: { minWidth: 62, textAlign: "right" }
      },
      fmtP(z.price)
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, (z.kinds || []).slice(0, 3).join(" + ")), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, z.role, z.strength ? ` \xB7 ${z.strength} dims` : ""), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { fontSize: 12 },
        onClick: () => setTicket({ level: z.price, kind: (z.kinds || []).join(" + "), role: z.role })
      },
      "ticket"
    ))))), p && p.setups && p.setups.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Conditional setups"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 10, marginTop: 8 } }, p.setups.map((su, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-setup" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-trigger" }, "IF ", su.trigger), su.bias && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginBottom: 2 } }, su.bias), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, lineHeight: 1.5 } }, su.structure))))), p && p.levelLadder && p.levelLadder.length > 0 && /* @__PURE__ */ React.createElement("details", { className: "vg-card", open: true }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, "Level ladder (", p.levelLadder.length, ")", alerts.filter((a) => !a.fired_at).length > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \xB7 ", alerts.filter((a) => !a.fired_at).length, " alert", alerts.filter((a) => !a.fired_at).length === 1 ? "" : "s", " armed")), alerts.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, flexWrap: "wrap", margin: "8px 0 0" } }, alerts.filter((a) => !a.fired_at).map((a) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: a.id,
        className: "vg-badge warn",
        style: { cursor: "pointer", border: "none" },
        title: "click to disarm",
        onClick: () => dropAlert(a.id)
      },
      "\u{1F514} ",
      a.symbol,
      " ",
      a.price,
      " \u2715"
    )), alerts.filter((a) => a.fired_at).slice(-3).map((a) => /* @__PURE__ */ React.createElement("span", { key: a.id, className: "vg-badge plain" }, "fired ", a.symbol, " ", a.price, " @ ", String(a.fired_at).slice(11, 16), "Z"))), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, p.levelLadder.map((r, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", levelTone(r.kind)), style: { minWidth: 62, textAlign: "right" } }, fmtP(r.price)), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, r.kind), r.source && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, r.source), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { fontSize: 12 },
        title: alertAt(r.price) ? "alert armed \u2014 click to disarm" : "Telegram me when price crosses this level",
        onClick: () => {
          const a = alertAt(r.price);
          a ? dropAlert(a.id) : armAlert(r.price, r.kind);
        }
      },
      alertAt(r.price) ? "\u{1F514} armed" : "\u{1F514}"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { fontSize: 12, marginLeft: r.source ? 0 : "auto" },
        onClick: () => setTicket({ level: r.price, kind: r.kind, role: levelTone(r.kind) === "good" ? "support" : levelTone(r.kind) === "bad" ? "resistance" : null })
      },
      "ticket"
    ))))), p && p.edges && (p.edges.gex_regime_next_day_range || p.edges.day_time) && /* @__PURE__ */ React.createElement("details", { className: "vg-card" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, "Lookback edges"), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, fontSize: 14, lineHeight: 1.6 } }, p.edges.gex_regime_next_day_range && p.edges.gex_regime_next_day_range.read && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Gamma \u2192 next-day range:"), " ", p.edges.gex_regime_next_day_range.read), p.edges.day_time && p.edges.day_time.by_slot && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("b", null, "By time of day (avg 15m range):"), " ", Object.entries(p.edges.day_time.by_slot).map(([k, v]) => `${k} ${v}pt`).join(" \xB7 ")), p.edges.zone_hit_rate && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("b", null, "Zone hit-rate (Sentinel):"), " ", Math.round((p.edges.zone_hit_rate.hit_rate || 0) * 100), "% over", " ", p.edges.zone_hit_rate.tested, " tested (", p.edges.zone_hit_rate.avg_coverage_pct, "% coverage)"))), /* @__PURE__ */ React.createElement(GlossaryCard, { terms: [
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
  function parseRead(text) {
    if (!text) return null;
    const lines = String(text).split("\n").map((l) => l.trim());
    const setups = [];
    let cur = null;
    let provenance = null;
    for (const l of lines) {
      const setup = l.match(/^\*{0,2}SETUP(?:\s+\d+)?\s*[—:-]\s*(.+?)\*{0,2}$/i);
      if (setup) {
        cur = { name: setup[1].replace(/\*+/g, ""), rows: [] };
        setups.push(cur);
        continue;
      }
      const row = l.match(/^[·\-•]\s*(Trigger|Idea|Wrong if|Targets|Watch)\s*:\s*(.+)$/i);
      if (row && cur) {
        cur.rows.push({ k: row[1], v: row[2] });
        continue;
      }
      if (!provenance && /^Computed/i.test(l)) provenance = l;
      if (cur && l.startsWith("**")) cur = null;
    }
    if (setups.length === 0 || !setups.every((s) => s.rows.length >= 3)) return null;
    const chips = (provenance || "").split(/\.\s+|\.$/).map((s) => s.trim()).filter((s) => s && s.length < 90);
    return { chips, setups };
  }
  function ReadCards({ parsed }) {
    const tone = (k) => k === "Wrong if" ? "vg-down" : k === "Targets" ? "vg-up" : void 0;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, flexWrap: "wrap", marginBottom: 10 } }, parsed.chips.map((c, i) => /* @__PURE__ */ React.createElement("span", { key: i, className: "vg-badge plain", style: { fontSize: "var(--vg-text-xs)" } }, c))), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-setupgrid" }, parsed.setups.map((s) => /* @__PURE__ */ React.createElement("div", { key: s.name, className: "vg-pb-setupcard" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 6 } }, s.name), s.rows.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.k, className: "vg-pb-setuprow" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-pb-setupkey" }, r.k), /* @__PURE__ */ React.createElement("span", { className: tone(r.k), style: { fontSize: "var(--vg-text-sm)" } }, r.v)))))), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 8, fontSize: "var(--vg-text-xs)", opacity: 0.75 } }, "GEX uses overnight OI \u2014 blind to 0DTE (~half of volume) \xB7 context, not a signal (ADR-008) \xB7 no orders (ADR-010) \xB7 not financial advice \xB7 full level ladder below"));
  }
  function SummaryTile({ label, value, tone }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-tile" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12 } }, label), /* @__PURE__ */ React.createElement("div", { className: cls("vg-pb-tileval", tone) }, value));
  }
  function VolReadCard() {
    const q = useLive(() => getOdteRead("SPY"), null, []);
    const d = q.data;
    if (!d) return null;
    if (!d.available) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "0DTE vol read"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12 } }, d.note));
    }
    const tone = d.verdict === "SELL PREMIUM" ? "good" : d.verdict === "BUY / LONG VOL" ? "warn" : "plain";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "0DTE vol read ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "\u2014 ", d.underlying, " (SPX proxy) \xB7 exp ", d.expiry)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", tone), style: { fontSize: "var(--vg-text-sm)", fontWeight: 700 } }, d.verdict)), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 20, margin: "8px 0 4px", flexWrap: "wrap", fontVariantNumeric: "tabular-nums" } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "implied ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--vg-ink)" } }, d.implied_move_pct, "%"), " ", "($", d.straddle_usd, " straddle @ ", d.atm_strike, ")"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "delivered baseline ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--vg-ink)" } }, d.realized_scaled_pct ?? d.realized_med_pct ?? "\u2014", "%"), d.session_fraction_remaining != null && d.session_fraction_remaining < 1 ? ` (\u221At-scaled, ${Math.round(d.session_fraction_remaining * 100)}% of session left)` : " (20d med)"), d.ratio != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "ratio ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--vg-ink)" } }, d.ratio, "\xD7")), d.atm_iv != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "ATM IV ", (d.atm_iv * 100).toFixed(1), "%")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: "var(--vg-text-sm)" } }, d.verdict_note), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: "var(--vg-text-xs)", marginTop: 6, opacity: d.degraded ? 1 : 0.7 } }, d.degraded ? "\u26A0 STALE \u2014 " : "", "chain snapped ", d.age_minutes != null ? `${d.age_minutes} min ago` : "\u2014", " \xB7", " ", d.source, " \xB7 context, not a signal (ADR-008) \xB7 sitting out is a position"));
  }
  function MarketContextCard({ reg, sectors }) {
    const pct7 = (v) => v == null ? "\u2014" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
    const breadth = reg.breadth_pct_above_50ma;
    const breadthNote = breadth == null ? null : breadth < 40 ? "Narrow tape \u2014 backtests show a wider, mean-reversion-prone next day." : breadth > 60 ? "Broad participation \u2014 historically a calmer, tighter next day." : "Mixed breadth.";
    const stance = reg.vix_term_stance;
    const termNote = !stance ? null : stance === "backwardation" ? "Front-month stress \u2014 backtests show a materially wider next-day range." : "Term structure calm (contango).";
    const im = reg.intermarket || {};
    const imRow = (label, o) => o && typeof o === "object" ? /* @__PURE__ */ React.createElement("div", { key: label, className: "vg-mc-im" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontVariantNumeric: "tabular-nums" } }, o.level), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", o.chg_pct >= 0 ? "good" : "bad"), style: { fontSize: 12 } }, pct7(o.chg_pct))) : null;
    const lead = sectors && sectors[0];
    const lag = sectors && sectors.length > 1 && sectors[sectors.length - 1];
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Market context"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, margin: "2px 0 10px" } }, "The whole-market read behind today's bias \u2014 breadth, volatility term structure, sector rotation, and the cross-asset backdrop. Context only (ADR-008)."), /* @__PURE__ */ React.createElement("div", { className: "vg-mc-grid" }, breadth != null && /* @__PURE__ */ React.createElement("div", { className: "vg-mc-block" }, /* @__PURE__ */ React.createElement("div", { className: "vg-mc-hd" }, "Breadth"), /* @__PURE__ */ React.createElement("div", { className: "vg-mc-big" }, breadth, "% ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, "above 50-day")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12 } }, "A/D ", reg.breadth_ad_ratio ?? "\u2014"), breadthNote && /* @__PURE__ */ React.createElement("div", { className: "vg-mc-edge" }, breadthNote)), reg.vix != null && /* @__PURE__ */ React.createElement("div", { className: "vg-mc-block" }, /* @__PURE__ */ React.createElement("div", { className: "vg-mc-hd" }, "Volatility"), /* @__PURE__ */ React.createElement("div", { className: "vg-mc-big" }, "VIX ", fmtP(reg.vix), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, reg.vix_band || "")), stance && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12 } }, "term structure ", stance, reg.vix_contango != null ? ` (${reg.vix_contango > 0 ? "+" : ""}${reg.vix_contango} vs VIX3M)` : ""), termNote && /* @__PURE__ */ React.createElement("div", { className: "vg-mc-edge" }, termNote)), lead && /* @__PURE__ */ React.createElement("div", { className: "vg-mc-block" }, /* @__PURE__ */ React.createElement("div", { className: "vg-mc-hd" }, "Sector rotation"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14 } }, "\u25B2 ", lead.name, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, lead.ret_20d_pct != null ? `+${lead.ret_20d_pct}% 20d` : "")), lag && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14 } }, "\u25BC ", lag.name, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, lag.ret_20d_pct != null ? `${lag.ret_20d_pct}% 20d` : ""))), im.available && /* @__PURE__ */ React.createElement("div", { className: "vg-mc-block" }, /* @__PURE__ */ React.createElement("div", { className: "vg-mc-hd" }, "Intermarket"), [["DXY", im.dxy], ["10Y", im.tnx], ["Oil", im.oil], ["Gold", im.gold]].map(([l, o]) => imRow(l, o)))));
  }
  function TicketModal({ sym, spot, seed, onClose, signalPaperId }) {
    const defSide = seed.role === "support" ? "long" : seed.role === "resistance" ? "short" : spot != null && seed.level > spot ? "short" : "long";
    const [side, setSide] = useState3(defSide);
    const [risk, setRisk] = useState3(500);
    const [res, setRes] = useState3(null);
    const [copied, setCopied] = useState3(false);
    const [account, setAccount] = useState3(
      () => {
        try {
          return localStorage.getItem("vantage.exec.account") || "";
        } catch (e) {
          return "";
        }
      }
    );
    const [policy, setPolicy] = useState3("ladder");
    const [exec, setExec] = useState3(null);
    const [armed, setArmed] = useState3(false);
    const stage = async () => {
      setRes({ loading: true });
      setCopied(false);
      setExec(null);
      setArmed(false);
      const v = await getTicket(sym, side, seed.level, risk || 0, seed.entry || null);
      setRes(v.available ? { ticket: v.ticket, text: v.text } : { error: true, note: v.note });
    };
    const runExecute = async (live) => {
      try {
        localStorage.setItem("vantage.exec.account", account);
      } catch (e) {
      }
      setExec({ loading: true });
      setArmed(false);
      const v = await executeTicket({
        symbol: sym,
        side,
        level: seed.level,
        risk: risk || 0,
        account_number: account,
        exit_policy: policy,
        live: !!live,
        ...seed.entry ? { entry: seed.entry } : {},
        ...signalPaperId ? { signal_paper_id: signalPaperId } : {}
      });
      setExec(v && v.available ? v : { error: true, note: v && v.note || "execute failed" });
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
    ))), /* @__PURE__ */ React.createElement("label", { className: "vg-note", style: { fontSize: 13 } }, "risk $", /* @__PURE__ */ React.createElement(
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
    )), res && res.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0" } }, res.note), tk && /* @__PURE__ */ React.createElement(React.Fragment, null, tk.derived_from && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0 0", fontSize: 13 } }, tk.derived_from.index, " is an index \u2014 staged in ", /* @__PURE__ */ React.createElement("b", null, tk.symbol), " at the live ratio ", tk.derived_from.ratio.toFixed(5), "."), /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { marginTop: 8, fontSize: 14 } }, /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "Entry"), /* @__PURE__ */ React.createElement("td", null, o.entry.action, " ", /* @__PURE__ */ React.createElement("b", null, o.entry.qty), " @ ", /* @__PURE__ */ React.createElement("b", null, o.entry.price), " limit")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "Stop"), /* @__PURE__ */ React.createElement("td", null, o.stop.action, " ", o.stop.qty, " @ ", /* @__PURE__ */ React.createElement("b", null, o.stop.price), " stop", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 max loss ", tk.risk.max_loss_at_stop))), o.targets.map((t) => /* @__PURE__ */ React.createElement("tr", { key: t.name }, /* @__PURE__ */ React.createElement("td", null, t.name), /* @__PURE__ */ React.createElement("td", null, o.stop.action, " ", t.qty, " @ ", /* @__PURE__ */ React.createElement("b", null, t.price), " limit", t.risk_reward != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 R:R ", t.risk_reward)))))), !tk.sized && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0" } }, "Risk budget too small for 1 share at this stop distance."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0", fontSize: 12 } }, "Staged. Place manually (Copy as text), or execute below \u2014 the gated ADR-010 v2 path: the server recomputes this ticket and submits entry + GTC stop to Robinhood; targets/trailing are managed by the exit monitor."), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: copy }, copied ? "Copied \u2713" : "Copy as text")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--lk-border, #333)" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: "0 0 8px", fontSize: 12 } }, "Execute \xB7 Robinhood"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("label", { className: "vg-note", style: { fontSize: 13 } }, "account #", /* @__PURE__ */ React.createElement(
      "input",
      {
        value: account,
        placeholder: "agentic-allowed acct",
        style: { width: 110, marginLeft: 4 },
        onChange: (e) => setAccount(e.target.value.trim())
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-symsw", role: "tablist", "aria-label": "exit policy" }, ["ladder", "trailing"].map((p) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: p,
        role: "tab",
        "aria-selected": p === policy,
        className: cls("vg-symsw-btn", p === policy && "on"),
        title: p === "ladder" ? "validated: stop rests; monitor swaps to the T1 target" : "opt-in: monitor ratchets the stop by the initial stop distance",
        onClick: () => setPolicy(p)
      },
      p
    ))), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        disabled: !account || exec && exec.loading,
        onClick: () => runExecute(false)
      },
      exec && exec.loading ? "Executing\u2026" : "Dry-run"
    ), exec && exec.execution && exec.execution.mode === "dry_run" && !armed && /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => setArmed(true) }, "Arm live\u2026"), armed && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        style: { borderColor: "#c0392b", color: "#c0392b" },
        onClick: () => runExecute(true)
      },
      "CONFIRM LIVE EXECUTE"
    )), exec && exec.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0" } }, exec.note), exec && exec.execution && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0, fontSize: 13 } }, /* @__PURE__ */ React.createElement("b", null, exec.execution.mode === "live" ? "LIVE" : "dry run"), " \xB7 ", exec.execution.legs.length, " leg(s)", exec.execution.managed_position_id != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 managed position #", exec.execution.managed_position_id, " \u2192 see Managed Exits")), /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { marginTop: 6, fontSize: 13 } }, /* @__PURE__ */ React.createElement("tbody", null, exec.execution.legs.map((l, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, l.leg), /* @__PURE__ */ React.createElement("td", null, l.side, " ", l.quantity, " ", l.type, l.limit_price != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " @ ", l.limit_price), l.stop_price != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " stop ", l.stop_price), " \xB7 ", l.status))))), (exec.execution.warnings || []).map((w, i) => /* @__PURE__ */ React.createElement("p", { key: i, className: "vg-note", style: { margin: "4px 0 0", fontSize: 12 } }, "\u26A0 ", w))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0", fontSize: 12 } }, "Dry-run always; live needs the confirm AND server env VANTAGE_LIVE_OK=1. Keep the exit monitor running while a live position is open.")))));
  }
  function PineModal({ pine, session, onClose, title = "TradingView Pine", symbol = "SPX" }) {
    const [copied, setCopied] = useState3(false);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(pine.script || "");
        setCopied(true);
      } catch (e) {
        setCopied(false);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-modal-backdrop", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-modal", onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, title, session ? ` \xB7 ${session}` : ""), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: onClose }, "close")), pine.loading && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0" } }, "Generating script\u2026"), pine.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "10px 0" } }, "No script \u2014 regenerate the levels first."), pine.script && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0" } }, "Copy \u2192 TradingView ", /* @__PURE__ */ React.createElement("b", null, "Pine Editor"), " \u2192 Add to chart on a ", /* @__PURE__ */ React.createElement("b", null, symbol), " chart. Levels & setups are baked from the latest data; the green/red background and the arrows update live off price vs the gamma flip. ", /* @__PURE__ */ React.createElement("b", null, "Not financial advice"), " \u2014 conditional context, and the GEX read is 0DTE-blind."), /* @__PURE__ */ React.createElement(
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

  // src/desk_rail.jsx
  var { useEffect: useEffect4, useState: useState4 } = React;
  var backend = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl || "http://127.0.0.1:8641").replace(/\/+$/, "");
  var money4 = (v) => v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}$${Math.abs(v).toLocaleString(void 0, { maximumFractionDigits: 0 })}`;
  var todayISO = () => new Intl.DateTimeFormat(
    "en-CA",
    { timeZone: "America/New_York" }
  ).format(/* @__PURE__ */ new Date());
  function AlertsBlock({ refreshNonce }) {
    const [nonce, setNonce] = useState4(0);
    const alertsQ = useLive(() => getJson(`${backend()}/api/alerts`), null, [refreshNonce, nonce]);
    const spotQ = useLive(() => getJson(`${backend()}/api/spx/playbook?symbol=SPX`), null, [refreshNonce]);
    const alerts = alertsQ.data && alertsQ.data.alerts || [];
    const spot = (((spotQ.data || {}).scaffold || {}).regime || {}).spot;
    const armed = alerts.filter((a) => !a.fired_at);
    const fired = alerts.filter((a) => a.fired_at).slice(-2);
    const drop = async (id) => {
      await fetch(`${backend()}/api/alerts/${id}`, { method: "DELETE" }).catch(() => {
      });
      setNonce((n) => n + 1);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, "Alerts"), /* @__PURE__ */ React.createElement("a", { className: "vg-note", href: "#/cockpit", style: { fontSize: 12 } }, "arm on the ladder \u2192")), armed.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0", fontSize: 13 } }, "None armed. \u{1F514} a ladder level and Telegram pings you on the cross."), armed.map((a) => {
      const dist = spot != null && a.symbol === "SPX" ? a.price - spot : null;
      return /* @__PURE__ */ React.createElement("div", { key: a.id, className: "vg-row", style: { gap: 8, marginTop: 8, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn" }, "\u{1F514} ", a.symbol, " ", a.price), dist != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontVariantNumeric: "tabular-nums", fontSize: 12 } }, dist >= 0 ? "+" : "", dist.toFixed(1), "pt away"), a.note && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } }, a.note), /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-linkbtn",
          style: { fontSize: 12, marginLeft: "auto" },
          title: "disarm",
          onClick: () => drop(a.id)
        },
        "\u2715"
      ));
    }), fired.map((a) => /* @__PURE__ */ React.createElement("div", { key: a.id, className: "vg-note", style: { marginTop: 6, fontSize: 12 } }, "fired \xB7 ", a.symbol, " ", a.price, " @ ", String(a.fired_at).slice(11, 16), "Z")));
  }
  function OpenRiskBlock({ refreshNonce }) {
    const q = useLive(
      () => getJson(`${backend()}/api/journal/activity?day=${todayISO()}`),
      null,
      [refreshNonce]
    );
    const d = q.data && q.data.available !== false ? q.data : null;
    const trades = d && d.trades || [];
    const open = trades.filter((t) => t.status === "open");
    const realized = trades.reduce((s, t) => s + (t.realized || 0), 0);
    const closedN = trades.length - open.length;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, "Today \u2014 open risk"), /* @__PURE__ */ React.createElement("a", { className: "vg-note", href: "#/journal", style: { fontSize: 12 } }, "journal \u2192")), !d && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0", fontSize: 13 } }, q.loading ? "\u2026" : "No trades yet today."), d && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0", fontSize: 13 } }, "realized ", /* @__PURE__ */ React.createElement("b", { className: realized >= 0 ? "vg-up" : "vg-down" }, money4(realized)), " ", "\xB7 ", closedN, " closed \xB7 ", open.length, " open"), open.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-row", style: { gap: 8, marginTop: 6, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { fontSize: 12 } }, t.ticker || "SPX"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 600 } }, t.label), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, money4(t.cost), " in"))));
  }
  function StrategyPulseBlock({ refreshNonce }) {
    const q = useLive(() => getJson(`${backend()}/api/paper/spreads`), null, [refreshNonce]);
    const bs = q.data && q.data.by_strategy || null;
    if (!bs || !Object.keys(bs).length) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, "Strategy pulse"), /* @__PURE__ */ React.createElement("a", { className: "vg-note", href: "#/scanner", style: { fontSize: 12 } }, "book \u2192")), /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { marginTop: 6, width: "100%" } }, /* @__PURE__ */ React.createElement("tbody", null, Object.entries(bs).map(([name, s]) => /* @__PURE__ */ React.createElement("tr", { key: name }, /* @__PURE__ */ React.createElement("td", { style: { fontSize: 12 } }, name), /* @__PURE__ */ React.createElement("td", { className: "vg-note", style: { fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums" } }, s.open || 0, " open", s.n ? ` \xB7 ${Math.round((s.win_rate || 0) * 100)}%` : ""), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }, s.n ? /* @__PURE__ */ React.createElement("b", { className: s.total_pnl >= 0 ? "vg-up" : "vg-down", style: { fontSize: 12 } }, money4(s.total_pnl)) : /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, "\u2014"), s.live_taken ? /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { fontSize: 10, marginLeft: 4 } }, s.live_taken, " live") : null))))));
  }
  var ORDER = {
    scanner: [AlertsBlock, OpenRiskBlock],
    journal: [OpenRiskBlock, AlertsBlock, StrategyPulseBlock],
    trades: [OpenRiskBlock, StrategyPulseBlock, AlertsBlock]
  };
  function DeskRail({ route, refreshNonce }) {
    const blocks = ORDER[route] || ORDER.scanner;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body", style: { paddingTop: 0 } }, blocks.map((B, i) => /* @__PURE__ */ React.createElement(B, { key: i, refreshNonce })));
  }

  // src/chart_theme.jsx
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

  // src/indicators.js
  function sma(candles, period) {
    if (!candles || candles.length < period || period < 1) return [];
    const out = [];
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) out.push({ time: candles[i].time, value: round(sum / period) });
    }
    return out;
  }
  function vwap(candles) {
    if (!candles || !candles.length) return [];
    if (!candles.some((c) => (c.volume || 0) > 0)) return [];
    const out = [];
    let day = null, pv = 0, vol = 0;
    for (const c of candles) {
      const d = dayKey(c.time);
      if (d !== day) {
        day = d;
        pv = 0;
        vol = 0;
      }
      const tp = (c.high + c.low + c.close) / 3;
      const v = c.volume || 0;
      pv += tp * v;
      vol += v;
      if (vol > 0) out.push({ time: c.time, value: round(pv / vol) });
    }
    return out;
  }
  function rsi(candles, period = 14) {
    if (!candles || candles.length <= period) return [];
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = candles[i].close - candles[i - 1].close;
      if (ch >= 0) gain += ch;
      else loss -= ch;
    }
    let avgG = gain / period, avgL = loss / period;
    const out = [{ time: candles[period].time, value: rsiVal(avgG, avgL) }];
    for (let i = period + 1; i < candles.length; i++) {
      const ch = candles[i].close - candles[i - 1].close;
      const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out.push({ time: candles[i].time, value: rsiVal(avgG, avgL) });
    }
    return out;
  }
  function volumeProfile(candles, up, down, buckets = 60) {
    if (!candles || !candles.length || !candles.some((c) => (c.volume || 0) > 0)) {
      return { bars: [], poc: null };
    }
    const bars = candles.map((c) => ({
      time: c.time,
      value: c.volume || 0,
      color: c.close >= c.open ? up : down
    }));
    let lo = Infinity, hi = -Infinity;
    for (const c of candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
    }
    if (!(hi > lo)) return { bars, poc: null };
    const width = (hi - lo) / buckets;
    const acc = new Array(buckets).fill(0);
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      let b = Math.floor((tp - lo) / width);
      if (b < 0) b = 0;
      else if (b >= buckets) b = buckets - 1;
      acc[b] += c.volume || 0;
    }
    let best = 0;
    for (let i = 1; i < buckets; i++) if (acc[i] > acc[best]) best = i;
    const poc = round(lo + (best + 0.5) * width);
    return { bars, poc };
  }
  function rsiVal(avgG, avgL) {
    if (avgL === 0) return avgG === 0 ? 50 : 100;
    const rs = avgG / avgL;
    return round(100 - 100 / (1 + rs));
  }
  function dayKey(t) {
    return Math.floor(t / 86400);
  }
  function round(x) {
    return Math.round(x * 100) / 100;
  }

  // src/chart_drawings.jsx
  var DEFAULT_COLOR = "#B97A16";
  function drawOne(chart, candle, d) {
    const color = d.style && d.style.color || DEFAULT_COLOR;
    const width = d.style && d.style.width || 1.5;
    const pts2 = d.points || [];
    if (d.kind === "hline") {
      if (!pts2.length) return null;
      const line2 = candle.createPriceLine({
        price: pts2[0].price,
        color,
        lineWidth: Math.round(width),
        lineStyle: 0,
        axisLabelVisible: true,
        title: d.style?.label || ""
      });
      return { kind: "priceLine", handle: line2 };
    }
    const series = chart.addLineSeries({
      color,
      lineWidth: width,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    series.setData(segmentData(d, chart));
    return { kind: "series", handle: series };
  }
  function segmentData(d, chart) {
    const [a, b] = d.points;
    if (d.kind === "rect") {
      const t0 = Math.min(a.time, b.time), t1 = Math.max(a.time, b.time);
      const p0 = a.price, p1 = b.price;
      return sortByTime([
        { time: t0, value: p0 },
        { time: t1, value: p0 },
        { time: t1, value: p1 },
        { time: t0, value: p1 },
        { time: t0, value: p0 }
      ]);
    }
    if (d.kind === "ray") {
      const last = lastTime(chart) || Math.max(a.time, b.time);
      const [lo, hi] = a.time <= b.time ? [a, b] : [b, a];
      const slope = (hi.price - lo.price) / (hi.time - lo.time || 1);
      const endT = Math.max(hi.time, last);
      const endP = lo.price + slope * (endT - lo.time);
      return [{ time: lo.time, value: lo.price }, { time: endT, value: endP }];
    }
    return sortByTime([{ time: a.time, value: a.price }, { time: b.time, value: b.price }]);
  }
  function sortByTime(rows) {
    return rows.slice().sort((x, y) => x.time - y.time);
  }
  function lastTime(chart) {
    try {
      const r = chart.timeScale().getVisibleRange();
      return r ? r.to : null;
    } catch (e) {
      return null;
    }
  }
  function removeOne(chart, candle, drawn) {
    if (!drawn) return;
    try {
      if (drawn.kind === "priceLine") candle.removePriceLine(drawn.handle);
      else chart.removeSeries(drawn.handle);
    } catch (e) {
    }
  }

  // src/chart_layers.jsx
  var NEAR_N = 5;
  function timeSpan(candles) {
    if (!candles || !candles.length) return [0, 0];
    return [candles[0].time, candles[candles.length - 1].time];
  }
  function nearest(arr, mid, px2, n) {
    return (arr || []).slice().sort((a, b) => Math.abs(mid(a) - px2) - Math.abs(mid(b) - px2)).slice(0, n);
  }
  var LAYER_DRAWERS = {
    levels(ctx) {
      const th = chartTheme();
      const out = [];
      const sel = ctx.selectedLevel;
      const [t0, t1] = timeSpan(ctx.candles);
      const px2 = ctx.price;
      const isSel = (lv) => sel != null && Math.abs(lv.price - sel) < 0.01;
      const all = (ctx.layers.levels || []).filter((lv) => isSel(lv) || px2 == null || Math.abs(lv.price - px2) <= px2 * 0.012);
      const featured = new Set(px2 == null ? all : [
        ...all.filter((l) => l.price >= px2).sort((a, b) => a.price - b.price).slice(0, 2),
        ...all.filter((l) => l.price < px2).sort((a, b) => b.price - a.price).slice(0, 2)
      ]);
      for (const lv of all) {
        const full = featured.has(lv) || isSel(lv);
        let lbl = String(lv.label || "");
        let isRes = /resist|call wall/i.test(lbl);
        let isSup = /support|put wall|max pain/i.test(lbl);
        const band = lv.lo != null && lv.hi != null && lv.hi > lv.lo;
        const sr = /^(resistance|support)/i.exec(lbl);
        let testing = false;
        if (sr && ctx.price != null) {
          const above = band ? lv.lo > ctx.price : lv.price > ctx.price;
          const below = band ? lv.hi < ctx.price : lv.price < ctx.price;
          testing = band && !above && !below;
          if (testing) {
            lbl = `testing${lbl.slice(sr[1].length)}`;
          } else {
            const live = above ? "resistance" : "support";
            isRes = live === "resistance";
            isSup = !isRes;
            if (live !== sr[1].toLowerCase())
              lbl = `${live} \xB7flip${lbl.slice(sr[1].length)}`;
          }
        }
        const rgb = testing ? [176, 106, 0] : isRes ? th.downRgb : isSup ? th.upRgb : [176, 106, 0];
        const selHere = isSel(lv);
        const alpha = sel != null ? selHere ? 0.95 : 0.18 : full ? 0.6 : 0.3;
        if (band && t0 && t1 && full && (sel == null || selHere)) {
          out.push(...zone(ctx, t0, t1, lv.hi, lv.lo, rgb.join(","), 0.1, ""));
        }
        out.push({ kind: "line", handle: ctx.candle.createPriceLine({
          price: lv.price,
          color: `rgba(${rgb.join(",")},${alpha})`,
          lineWidth: selHere ? 2 : full && /wall|max pain|durable/i.test(lbl) ? 2 : 1,
          lineStyle: ctx.LW.LineStyle.Dashed,
          axisLabelVisible: full && (sel == null || selHere),
          title: !full || sel != null && !selHere ? "" : lbl.replace(/\s*[★✦].*$/, "").slice(0, 30)
        }) });
      }
      return out;
    },
    orderBlocks(ctx) {
      const th = chartTheme();
      const [t0, t1] = timeSpan(ctx.candles);
      return nearest(ctx.layers.order_blocks, (o) => (o.top + o.bottom) / 2, ctx.price, NEAR_N).map((o) => {
        const rgb = (o.side === "bull" ? th.upRgb : th.downRgb).join(",");
        return zone(
          ctx,
          t0,
          t1,
          o.top,
          o.bottom,
          rgb,
          0.14,
          o.side === "bull" ? "buyers' zone (OB)" : "sellers' zone (OB)"
        );
      }).flat();
    },
    fvgs(ctx) {
      const th = chartTheme();
      const [t0, t1] = timeSpan(ctx.candles);
      return nearest(ctx.layers.fvgs, (f) => (f.hi + f.lo) / 2, ctx.price, NEAR_N).map((f) => {
        const rgb = (f.side === "bull" ? th.upRgb : th.downRgb).join(",");
        return zone(
          ctx,
          t0,
          t1,
          f.hi,
          f.lo,
          rgb,
          0.1,
          `unfilled gap ${f.side === "bull" ? "\u2191" : "\u2193"} (FVG)`
        );
      }).flat();
    },
    liquidity(ctx) {
      const liq = ctx.layers.liquidity || {};
      const rgb = "184,122,22";
      const out = [];
      for (const p of nearest(liq.bsl, (x) => x, ctx.price, 4)) {
        out.push(line(ctx, p, rgb, 0.6, ctx.LW.LineStyle.Dotted, "stops above (BSL)"));
      }
      for (const p of nearest(liq.ssl, (x) => x, ctx.price, 4)) {
        out.push(line(ctx, p, rgb, 0.6, ctx.LW.LineStyle.Dotted, "stops below (SSL)"));
      }
      return out;
    },
    draw(ctx) {
      const d = ctx.layers.draw;
      if (!d || d.level == null) return [];
      return [line(
        ctx,
        d.level,
        "124,92,255",
        0.9,
        ctx.LW.LineStyle.Dotted,
        `price magnet ${d.dir === "up" ? "\u2191" : "\u2193"} (draw)`,
        2
      )];
    },
    prior(ctx) {
      const p = ctx.layers.prior || {};
      const out = [];
      const mk = (price, label) => price != null && out.push(line(ctx, price, "120,120,130", 0.7, ctx.LW.LineStyle.Dashed, label));
      mk(p.prev_high, "PDH");
      mk(p.prev_low, "PDL");
      mk(p.prev_close, "PDC");
      return out;
    },
    gex(ctx) {
      const g = ctx.layers.gex || {};
      const th = chartTheme();
      const out = [];
      const mk = (price, label, rgb) => price != null && out.push(line(ctx, price, rgb, 0.8, ctx.LW.LineStyle.Solid, label, 1));
      mk(g.call_wall, "call wall", th.downRgb.join(","));
      mk(g.put_wall, "put wall", th.upRgb.join(","));
      mk(g.gamma_flip, "\u03B3 flip", "176,106,0");
      mk(g.max_pain, "max pain", "120,120,130");
      return out;
    },
    // the investor's OWN context: cost-basis line (dotted violet) + the ticker-plan
    // target/stop. The "where am I on this holding" read. Reads ctx.position; the
    // cost-line style is the same one the old AI Charts view used (charts.jsx).
    position(ctx) {
      const p = ctx.position;
      if (!p) return [];
      const out = [];
      if (p.cost_basis != null) out.push({ kind: "line", handle: ctx.candle.createPriceLine({
        price: p.cost_basis,
        color: "rgba(168,85,247,0.9)",
        lineWidth: 1,
        lineStyle: ctx.LW.LineStyle.Dotted,
        axisLabelVisible: true,
        title: `cost ${p.cost_basis}`
      }) });
      const plan = p.plan || {};
      if (plan.target != null) out.push(line(
        ctx,
        plan.target,
        "31,157,107",
        0.9,
        ctx.LW.LineStyle.Dashed,
        `plan target ${plan.target}`,
        1
      ));
      if (plan.stop != null) out.push(line(
        ctx,
        plan.stop,
        "217,59,78",
        0.9,
        ctx.LW.LineStyle.Dashed,
        `plan stop ${plan.stop}`,
        1
      ));
      return out;
    },
    // the analyst's latest forecast: TARGET (green) / INVALIDATION (red) as reference
    // lines, and the numbered predicted PATH projected forward from the last candle
    // into the empty right space (so it reads "from here, price goes 1→2→3…").
    // Adapted from the Playbook overlay (spx_forecast.jsx). Reads ctx.forecast.
    forecast(ctx) {
      const fc = ctx.forecast;
      if (!fc) return [];
      const th = chartTheme();
      const out = [];
      if (fc.target != null) out.push({ kind: "line", handle: ctx.candle.createPriceLine({
        price: fc.target,
        color: `rgb(${th.upRgb.join(",")})`,
        lineWidth: 2,
        lineStyle: ctx.LW.LineStyle.Solid,
        axisLabelVisible: true,
        title: "\u{1F3AF} TARGET"
      }) });
      if (fc.invalidation != null) out.push({ kind: "line", handle: ctx.candle.createPriceLine({
        price: fc.invalidation,
        color: `rgb(${th.downRgb.join(",")})`,
        lineWidth: 2,
        lineStyle: ctx.LW.LineStyle.Solid,
        axisLabelVisible: true,
        title: "\u2715 INVALID"
      }) });
      const steps = (fc.path || []).filter((s) => s.price != null);
      const candles = ctx.candles;
      if (steps.length && candles.length) {
        const t1 = candles[candles.length - 1].time;
        const barSec = candles.length > 1 ? candles[candles.length - 1].time - candles[candles.length - 2].time || 300 : 300;
        const px0 = ctx.price || candles[candles.length - 1].close;
        const data = [{ time: t1, value: px0 }];
        const markers = [];
        const down = fc.bias === "down";
        steps.forEach((st, i) => {
          const tt = t1 + barSec * (i + 1);
          data.push({ time: tt, value: st.price });
          markers.push({
            time: tt,
            position: down ? "belowBar" : "aboveBar",
            shape: down ? "arrowDown" : "arrowUp",
            color: down ? `rgb(${th.downRgb.join(",")})` : `rgb(${th.upRgb.join(",")})`,
            text: `${st.seq} \xB7 ${st.price}${st.note ? " " + st.note : ""}`.slice(0, 34)
          });
        });
        try {
          const ps = ctx.chart.addLineSeries({
            color: "rgba(124,92,255,0.95)",
            lineWidth: 2,
            lineStyle: ctx.LW.LineStyle.Dashed,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: false
          });
          ps.setData(data);
          ps.setMarkers(markers);
          out.push({ kind: "series", handle: ps });
        } catch (e) {
        }
      }
      return out;
    },
    // a saved REPLAY run: the sequence of that day's forecasts drawn on the chart —
    // a marker at each forecast's origin (as_of / price_at) colored by its graded
    // verdict (hit target = green, invalidated = red, else neutral), plus a faint
    // target line per forecast. Reads ctx.replay = {forecasts:[{as_of_ts, price_at,
    // target, verdict}]}. Read-only; drawn from already-stored scores (no Mira).
    replay(ctx) {
      const rp = ctx.replay;
      if (!rp || !rp.forecasts || !rp.forecasts.length) return [];
      const th = chartTheme();
      const out = [];
      const markers = [];
      const [t0, t1] = timeSpan(ctx.candles);
      const inView = (t) => !(t0 && t1) || t >= t0 && t <= t1;
      const pts2 = [];
      let lastT = -Infinity;
      for (const f of rp.forecasts) {
        if (f.as_of_ts == null || f.price_at == null || !inView(f.as_of_ts)) continue;
        const hit = f.verdict === "hit target" || f.verdict === "direction correct";
        const bad = f.verdict === "invalidated" || f.verdict === "direction wrong";
        const color = hit ? `rgb(${th.upRgb.join(",")})` : bad ? `rgb(${th.downRgb.join(",")})` : "rgb(176,106,0)";
        const up = f.target != null && f.target >= f.price_at;
        const isActive = rp.activeCallId != null && f.id === rp.activeCallId;
        markers.push({
          time: f.as_of_ts,
          position: up ? "aboveBar" : "belowBar",
          shape: up ? "arrowUp" : "arrowDown",
          color,
          // terse (the live Calls layer): color alone grades 26 markers — the
          // verdict text on every arrow is noise. Replay keeps the labels.
          text: isActive ? `${f.target != null ? "\u2192" + f.target : ""} ${f.verdict || ""}`.trim().slice(0, 24) : rp.terse ? "" : f.verdict || ""
        });
        if (f.target != null) {
          const tt = f.as_of_ts <= lastT ? lastT + 1 : f.as_of_ts;
          pts2.push({ time: tt, value: f.target });
          lastT = tt;
        }
      }
      if (pts2.length && !rp.terse) {
        try {
          const ps = ctx.chart.addLineSeries({
            color: "rgba(124,92,255,0.95)",
            lineWidth: 2,
            lineStyle: ctx.LW.LineStyle.Solid,
            lastValueVisible: false,
            priceLineVisible: false,
            crosshairMarkerVisible: true,
            pointMarkersVisible: true
          });
          ps.setData(pts2);
          out.push({ kind: "series", handle: ps });
        } catch (e) {
        }
      }
      if (markers.length) {
        markers.sort((a, b) => a.time - b.time);
        try {
          ctx.candle.setMarkers(markers);
          out.push({ kind: "markers", handle: null });
        } catch (e) {
        }
      }
      return out;
    }
  };
  LAYER_DRAWERS.calls = (ctx) => ctx.dayCalls ? LAYER_DRAWERS.replay({ ...ctx, replay: { ...ctx.dayCalls, terse: true } }) : [];
  var LAYERS = [
    { key: "levels", label: "Levels", needsLevels: true },
    { key: "orderBlocks", label: "OB", needsLevels: false },
    { key: "fvgs", label: "FVG", needsLevels: false },
    { key: "liquidity", label: "Liq", needsLevels: false },
    { key: "draw", label: "Draw", needsLevels: false },
    { key: "prior", label: "PD H/L/C", needsLevels: false },
    { key: "gex", label: "GEX", needsLevels: true },
    { key: "position", label: "Position", needsLevels: false, needsPosition: true },
    { key: "forecast", label: "Forecast", needsLevels: false, needsForecast: true },
    { key: "calls", label: "Calls", needsLevels: true },
    { key: "replay", label: "Replay", needsLevels: false, needsReplay: true }
  ];
  function line(ctx, price, rgb, alpha, style, title, width = 1) {
    return { kind: "line", handle: ctx.candle.createPriceLine({
      price,
      color: `rgba(${rgb},${alpha})`,
      lineWidth: width,
      lineStyle: style,
      axisLabelVisible: true,
      title
    }) };
  }
  function zone(ctx, t0, t1, top, bottom, rgb, alpha, tag) {
    const area = ctx.chart.addBaselineSeries({
      baseValue: { type: "price", price: bottom },
      topFillColor1: `rgba(${rgb},${alpha})`,
      topFillColor2: `rgba(${rgb},${alpha})`,
      topLineColor: `rgba(${rgb},0.5)`,
      bottomLineColor: `rgba(${rgb},0.5)`,
      bottomFillColor1: "rgba(0,0,0,0)",
      bottomFillColor2: "rgba(0,0,0,0)",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    });
    area.setData([{ time: t0, value: top }, { time: t1, value: top }]);
    const handles = [{ kind: "zone", handle: area }];
    if (tag) handles.push({ kind: "line", handle: ctx.candle.createPriceLine({
      price: top,
      color: `rgba(${rgb},0.9)`,
      lineWidth: 1,
      lineStyle: ctx.LW.LineStyle.Dotted,
      axisLabelVisible: false,
      title: tag
    }) });
    return handles;
  }
  function removeLayerHandle(chart, candle, h) {
    if (!h) return;
    try {
      if (h.kind === "line") candle.removePriceLine(h.handle);
      else if (h.kind === "markers") candle.setMarkers([]);
      else chart.removeSeries(h.handle);
    } catch (e) {
    }
  }

  // src/chart_core.jsx
  var { useState: useState5, useRef, useEffect: useEffect5, useCallback } = React;
  var TOOLS = [
    { key: "cursor", label: "\u2316", title: "Cursor / pan", pts: 0 },
    { key: "hline", label: "\u2500", title: "Horizontal line", pts: 1 },
    { key: "trendline", label: "\u2571", title: "Trendline", pts: 2 },
    { key: "ray", label: "\u2192", title: "Ray", pts: 2 },
    { key: "rect", label: "\u25AD", title: "Rectangle", pts: 2 }
  ];
  var TOOL_PTS = Object.fromEntries(TOOLS.map((t) => [t.key, t.pts]));
  var _didSeq = 0;
  var newDrawingId = () => `d${(_didSeq++).toString(36)}${performance.now().toString(36).replace(".", "")}`;
  var TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D", "1W", "1M"];
  var hasLW = () => typeof window !== "undefined" && !!(window.LightweightCharts && window.LightweightCharts.createChart);
  var _etTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  var _etDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric"
  });
  var _etDateTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  var _toDate = (t) => typeof t === "object" && t !== null ? new Date(Date.UTC(t.year, (t.month || 1) - 1, t.day || 1)) : new Date(t * 1e3);
  function etTickFormatter(time, tickType) {
    const d = _toDate(time);
    return tickType >= 3 ? _etTime.format(d) : _etDate.format(d);
  }
  function etTimeFormatter(time) {
    const d = _toDate(time);
    return typeof time === "object" ? _etDate.format(d) : _etDateTime.format(d);
  }
  var INDICATORS = [
    { key: "ma20", label: "MA20", needsVol: false },
    { key: "ma50", label: "MA50", needsVol: false },
    { key: "vwap", label: "VWAP", needsVol: true },
    { key: "vol", label: "Vol", needsVol: true },
    { key: "rsi", label: "RSI", needsVol: false }
  ];
  var IND_PREF_KEY = "vg.ic.indicators";
  var loadPref = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(IND_PREF_KEY) || "[]"));
    } catch (e) {
      return /* @__PURE__ */ new Set();
    }
  };
  var savePref = (set) => {
    try {
      localStorage.setItem(IND_PREF_KEY, JSON.stringify([...set]));
    } catch (e) {
    }
  };
  var TF_HAS_VOLUME = (tf) => ["1m", "5m", "15m", "1H", "4H"].includes(tf);
  var LAYER_PREF_KEY = "vg.ic.layers";
  var loadLayerPref = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LAYER_PREF_KEY) || "[]"));
    } catch (e) {
      return /* @__PURE__ */ new Set();
    }
  };
  var saveLayerPref = (set) => {
    try {
      localStorage.setItem(LAYER_PREF_KEY, JSON.stringify([...set]));
    } catch (e) {
    }
  };
  function ohlcText(bar) {
    if (!bar) return null;
    const d = bar.close >= bar.open;
    return { o: bar.open, h: bar.high, l: bar.low, c: bar.close, up: d };
  }
  function setInd(drawn, key, candles, th) {
    const h = drawn[key];
    if (!h) return;
    if (key === "ma20") h.setData(sma(candles, 20));
    else if (key === "ma50") h.setData(sma(candles, 50));
    else if (key === "vwap") h.setData(vwap(candles));
    else if (key === "rsi") h.setData(rsi(candles, 14));
    else if (key === "vol") {
      h.setData(volumeProfile(
        candles,
        `rgba(${th.upRgb.join(",")},0.5)`,
        `rgba(${th.downRgb.join(",")},0.5)`
      ).bars);
    }
  }
  var REPLAY_SYMBOLS = ["SPX", "QQQ", "IWM"];
  function InstrumentChart({
    symbol,
    tf,
    setTf,
    overlays,
    height,
    replayRunId,
    replayActive,
    onReplayToggle,
    onForecastNow,
    forecastNonce,
    activeCallId,
    setActiveCallId,
    onOpenSymbol,
    initialLayers,
    compact,
    seriesType = "candles"
  }) {
    const elRef = useRef(null);
    const [symInput, setSymInput] = useState5("");
    const chartRef = useRef(null);
    const candleRef = useRef(null);
    const fittedKey = useRef(null);
    const indRef = useRef({});
    const pocLineRef = useRef(null);
    const drawnRef = useRef({});
    const pendingRef = useRef([]);
    const toolRef = useRef("cursor");
    const commitDrawingRef = useRef(() => {
    });
    const levelClickRef = useRef(() => {
    });
    const [hover, setHover] = useState5(null);
    const [nonce, setNonce] = useState5(0);
    const [chartEpoch, setChartEpoch] = useState5(0);
    const [refreshing, setRefreshing] = useState5(false);
    const [active, setActive] = useState5(loadPref);
    const [tool, setTool] = useState5("cursor");
    const [drawings, setDrawings] = useState5([]);
    const [pendingN, setPendingN] = useState5(0);
    const [activeLayers, setActiveLayers] = useState5(
      () => initialLayers ? new Set(initialLayers) : loadLayerPref()
    );
    const persistLayers = initialLayers ? () => {
    } : saveLayerPref;
    const [selectedLevel, setSelectedLevel] = useState5(null);
    const selectedLevelRef = useRef(null);
    selectedLevelRef.current = selectedLevel;
    const layerHandlesRef = useRef({});
    toolRef.current = tool;
    const layerQ = useLive(
      () => symbol ? getLayers(symbol) : Promise.resolve(null),
      null,
      [symbol]
    );
    const layerData = layerQ.data && layerQ.data.available ? layerQ.data : null;
    const fcQ = useLive(
      () => symbol ? getChartForecast(symbol) : Promise.resolve(null),
      null,
      [symbol, forecastNonce]
    );
    const forecastData = fcQ.data && fcQ.data.available ? fcQ.data.forecast : null;
    useEffect5(() => {
      if (!forecastNonce) return;
      setActiveLayers((prev) => {
        if (prev.has("forecast")) return prev;
        const next = new Set(prev);
        next.add("forecast");
        persistLayers(next);
        return next;
      });
    }, [forecastNonce]);
    const posQ = useLive(
      () => symbol ? getPosition(symbol) : Promise.resolve(null),
      null,
      [symbol]
    );
    const positionData = posQ.data && posQ.data.available ? posQ.data : null;
    const replayShown = replayActive && !!replayRunId;
    const runDetailQ = useLive(
      () => replayShown ? getReplayRun(replayRunId) : Promise.resolve(null),
      null,
      [replayShown, replayRunId]
    );
    const replayData = React.useMemo(() => {
      const d = runDetailQ.data;
      if (!d || !d.available || !Array.isArray(d.forecasts)) return null;
      const forecasts = d.forecasts.map((f) => {
        const fc = f.forecast || {};
        const plot = fc && typeof fc === "object" ? fc.plot : null;
        const t = f.as_of ? Math.floor(new Date(f.as_of).getTime() / 1e3) : null;
        return {
          id: f.id,
          as_of: f.as_of,
          as_of_ts: t,
          price_at: f.price_at,
          bias: plot && plot.bias || "",
          path: plot && Array.isArray(plot.path) ? plot.path : [],
          target: plot && plot.target != null ? plot.target : null,
          invalidation: plot && plot.invalidation != null ? plot.invalidation : null,
          verdict: f.score && f.score.verdict || null
        };
      }).filter((f) => f.as_of_ts != null);
      return { run_id: d.run_id, forecasts, activeCallId };
    }, [runDetailQ.data, activeCallId]);
    const callsOn = activeLayers.has("calls");
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(/* @__PURE__ */ new Date());
    const dayCallsQ = useLive(
      () => callsOn && symbol ? getSpxForecasts(todayEt, symbol, 40) : Promise.resolve(null),
      null,
      [callsOn, symbol, forecastNonce]
    );
    const dayCallsData = React.useMemo(() => {
      const d = dayCallsQ.data;
      if (!d || !d.available || !Array.isArray(d.forecasts)) return null;
      const forecasts = d.forecasts.map((f) => {
        let fc = f.forecast || {};
        if (typeof fc === "string") {
          try {
            fc = JSON.parse(fc);
          } catch (e) {
            fc = {};
          }
        }
        const plot = fc.plot || {};
        let sc = f.score;
        if (typeof sc === "string") {
          try {
            sc = JSON.parse(sc);
          } catch (e) {
            sc = null;
          }
        }
        const t = f.as_of ? Math.floor(new Date(f.as_of).getTime() / 1e3) : null;
        return {
          id: f.id,
          as_of: f.as_of,
          as_of_ts: t,
          price_at: f.price_at,
          bias: plot.bias || "",
          path: Array.isArray(plot.path) ? plot.path : [],
          target: plot.target != null ? plot.target : null,
          invalidation: plot.invalidation != null ? plot.invalidation : null,
          verdict: sc && sc.verdict || null
        };
      }).filter((f) => f.as_of_ts != null);
      return forecasts.length ? { forecasts, activeCallId: null } : null;
    }, [dayCallsQ.data]);
    const toggleLayer = useCallback((key) => {
      setActiveLayers((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        persistLayers(next);
        return next;
      });
    }, []);
    const toggleInd = useCallback((key) => {
      setActive((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        savePref(next);
        return next;
      });
    }, []);
    const commitDrawing = useCallback(async (kind, points) => {
      const d = { id: newDrawingId(), kind, points, style: {} };
      setDrawings((prev) => [...prev, d]);
      setTool("cursor");
      try {
        await saveDrawing(symbol, { id: d.id, kind, points, style: {} });
      } catch (e) {
      }
    }, [symbol]);
    commitDrawingRef.current = commitDrawing;
    useEffect5(() => {
      if (!activeLayers.has("levels")) setSelectedLevel(null);
    }, [activeLayers]);
    useEffect5(() => {
      setSelectedLevel(null);
    }, [symbol]);
    const clearDrawings = useCallback(async () => {
      const ids = drawings.map((d) => d.id);
      setDrawings([]);
      for (const id of ids) {
        try {
          await deleteDrawing(symbol, id);
        } catch (e) {
        }
      }
    }, [symbol, drawings]);
    const undoLastDrawing = useCallback(async () => {
      const last2 = drawings[drawings.length - 1];
      if (!last2) return;
      setDrawings((prev) => prev.slice(0, -1));
      try {
        await deleteDrawing(symbol, last2.id);
      } catch (e) {
      }
    }, [symbol, drawings]);
    const q = useLive(
      () => symbol ? getChart(symbol, tf) : Promise.resolve(null),
      null,
      [symbol, tf, nonce]
    );
    const doRefresh = useCallback(async (days = 1) => {
      if (!symbol || refreshing) return;
      setRefreshing(true);
      try {
        await refreshChart(symbol, tf, days);
      } catch (e) {
      } finally {
        setRefreshing(false);
        setNonce((n) => n + 1);
      }
    }, [symbol, tf, refreshing]);
    const data = q.data && q.data.available ? q.data : null;
    const candles = data && data.candles || [];
    const frameToLevel = useCallback((clickPrice) => {
      const levels = layerData && layerData.layers && layerData.layers.levels || [];
      if (!levels.length || !candles.length || clickPrice == null) return;
      let lv = null, best = Infinity;
      for (const l of levels) {
        const d = Math.abs(l.price - clickPrice);
        if (d < best) {
          best = d;
          lv = l;
        }
      }
      if (!lv || best > Math.abs(clickPrice) * 4e-3) {
        setSelectedLevel(null);
        return;
      }
      if (selectedLevelRef.current != null && Math.abs(lv.price - selectedLevelRef.current) < 0.01) {
        setSelectedLevel(null);
        return;
      }
      let ci = 0, cbest = Infinity;
      candles.forEach((c, i) => {
        const d = lv.price > c.high ? lv.price - c.high : lv.price < c.low ? c.low - lv.price : 0;
        if (d < cbest) {
          cbest = d;
          ci = i;
        }
      });
      const chart = chartRef.current;
      if (chart) {
        const span = 40, gutter = 25;
        const fromIx = Math.max(0, ci - span);
        const toIx = Math.min(candles.length - 1, ci + span) + gutter;
        requestAnimationFrame(() => {
          try {
            chart.timeScale().setVisibleLogicalRange({ from: fromIx, to: toIx });
          } catch (e) {
          }
        });
      }
      setSelectedLevel(lv.price);
    }, [layerData, candles]);
    levelClickRef.current = frameToLevel;
    useEffect5(() => {
      const el = elRef.current;
      if (!el || !hasLW()) return void 0;
      const LW = window.LightweightCharts;
      const th = chartTheme();
      const chart = LW.createChart(el, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: th.text, fontSize: 12 },
        grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
        // render all times in Eastern (US market time), not the viewer's timezone.
        localization: { timeFormatter: etTimeFormatter },
        rightPriceScale: {
          borderColor: th.border,
          minimumWidth: 72,
          scaleMargins: { top: 0.08, bottom: 0.08 },
          autoScale: true
        },
        // rightOffset leaves ~25 blank bars on the right so price-line TITLE labels
        // (coach levels, PDH/PDL, DRAW…) land in the gutter instead of over the candles.
        timeScale: {
          borderColor: th.border,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 25,
          tickMarkFormatter: etTickFormatter
        },
        crosshair: { mode: LW.CrosshairMode.Normal },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true }
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true
        }
      });
      const candle = seriesType === "line" ? chart.addAreaSeries({
        lineColor: th.ink,
        lineWidth: 2,
        topColor: `rgba(${th.faintRgb.join(",")},0.18)`,
        bottomColor: "rgba(0,0,0,0)",
        priceLineVisible: true,
        lastValueVisible: true,
        crosshairMarkerVisible: true
      }) : chart.addCandlestickSeries({
        upColor: th.up,
        downColor: th.down,
        wickUpColor: th.up,
        wickDownColor: th.down,
        borderUpColor: th.up,
        borderDownColor: th.down
      });
      chartRef.current = chart;
      candleRef.current = candle;
      indRef.current = {};
      drawnRef.current = {};
      layerHandlesRef.current = {};
      pocLineRef.current = null;
      fittedKey.current = null;
      setChartEpoch((n) => n + 1);
      chart.subscribeCrosshairMove((p) => {
        if (!p || !p.time || !p.seriesData) {
          setHover(null);
          return;
        }
        const bar = p.seriesData.get(candle);
        setHover(bar ? bar.open != null ? ohlcText(bar) : { c: bar.value, up: true, lineOnly: true } : null);
      });
      chart.subscribeClick((p) => {
        const t = toolRef.current;
        const need = TOOL_PTS[t] || 0;
        if (t === "cursor") {
          if (p && p.point) levelClickRef.current(candle.coordinateToPrice(p.point.y));
          return;
        }
        if (!need || !p || !p.point) return;
        const price = candle.coordinateToPrice(p.point.y);
        const time = p.time != null ? p.time : chart.timeScale().coordinateToTime(p.point.x);
        if (price == null || time == null) return;
        pendingRef.current = [...pendingRef.current, { time, price: Math.round(price * 100) / 100 }];
        setPendingN(pendingRef.current.length);
        if (pendingRef.current.length >= need) {
          const pts2 = pendingRef.current;
          pendingRef.current = [];
          setPendingN(0);
          commitDrawingRef.current(t, pts2);
        }
      });
      return () => {
        chart.remove();
        chartRef.current = candleRef.current = null;
      };
    }, [seriesType]);
    useEffect5(() => {
      const candle = candleRef.current, chart = chartRef.current;
      if (!candle || !candles.length) return;
      candle.setData(seriesType === "line" ? candles.map((c) => ({ time: c.time, value: c.close })) : candles);
      const key = `${symbol}|${tf}`;
      if (chart && fittedKey.current !== key) {
        fittedKey.current = key;
        requestAnimationFrame(() => {
          try {
            chart.timeScale().fitContent();
          } catch (e) {
          }
        });
      }
    }, [candles, symbol, tf, seriesType, chartEpoch]);
    useEffect5(() => {
      if (!overlays || !chartRef.current || !candleRef.current || !candles.length) return void 0;
      return overlays({
        chart: chartRef.current,
        candle: candleRef.current,
        LW: window.LightweightCharts,
        candles
      });
    }, [overlays, candles, chartEpoch]);
    useEffect5(() => {
      const chart = chartRef.current;
      if (!chart) return void 0;
      const th = chartTheme();
      const drawn = indRef.current;
      const volOk = TF_HAS_VOLUME(tf);
      const want = new Set([...active].filter((k) => {
        const spec = INDICATORS.find((i) => i.key === k);
        return spec && (!spec.needsVol || volOk);
      }));
      const remove = (key) => {
        const h = drawn[key];
        if (!h) return;
        if (key === "vol" && pocLineRef.current) {
          try {
            candleRef.current?.removePriceLine(pocLineRef.current);
          } catch (e) {
          }
          pocLineRef.current = null;
        }
        try {
          chart.removeSeries(h);
        } catch (e) {
        }
        delete drawn[key];
      };
      for (const key of Object.keys(drawn)) if (!want.has(key)) remove(key);
      if (!candles.length) return void 0;
      const line2 = (color, opts = {}) => chart.addLineSeries({
        color,
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        ...opts
      });
      for (const key of want) {
        if (drawn[key] && key === "vol") remove(key);
        else if (drawn[key]) {
          setInd(drawn, key, candles, th);
          continue;
        }
        if (key === "ma20") {
          drawn[key] = line2(th.accent);
          drawn[key].setData(sma(candles, 20));
        } else if (key === "ma50") {
          drawn[key] = line2(th.text);
          drawn[key].setData(sma(candles, 50));
        } else if (key === "vwap") {
          drawn[key] = line2(th.strike || "#7b61ff", { lineStyle: 2 });
          drawn[key].setData(vwap(candles));
        } else if (key === "rsi") {
          const s = chart.addLineSeries({
            color: th.accent,
            lineWidth: 1.5,
            priceScaleId: "rsi",
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: false
          });
          try {
            chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
          } catch (e) {
          }
          s.setData(rsi(candles, 14));
          drawn[key] = s;
        } else if (key === "vol") {
          const { bars, poc } = volumeProfile(
            candles,
            `rgba(${th.upRgb.join(",")},0.5)`,
            `rgba(${th.downRgb.join(",")},0.5)`
          );
          const s = chart.addHistogramSeries({
            priceScaleId: "vol",
            priceFormat: { type: "volume" },
            priceLineVisible: false,
            lastValueVisible: false
          });
          try {
            chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });
          } catch (e) {
          }
          s.setData(bars);
          drawn[key] = s;
          if (pocLineRef.current) {
            try {
              candleRef.current.removePriceLine(pocLineRef.current);
            } catch (e) {
            }
            pocLineRef.current = null;
          }
          if (poc != null) {
            try {
              pocLineRef.current = candleRef.current.createPriceLine({
                price: poc,
                color: th.accent,
                lineWidth: 1,
                lineStyle: 3,
                axisLabelVisible: true,
                title: "POC"
              });
            } catch (e) {
            }
          }
        }
      }
      return void 0;
    }, [candles, active, tf, chartEpoch]);
    useEffect5(() => {
      let alive = true;
      pendingRef.current = [];
      setPendingN(0);
      if (!symbol) {
        setDrawings([]);
        return void 0;
      }
      getDrawings(symbol).then((r) => {
        if (alive && r && r.available) setDrawings(r.drawings || []);
      }).catch(() => {
      });
      return () => {
        alive = false;
      };
    }, [symbol]);
    useEffect5(() => {
      const chart = chartRef.current, candle = candleRef.current;
      if (!chart || !candle) return void 0;
      const drawn = drawnRef.current;
      const wanted = new Set(drawings.map((d) => d.id));
      for (const id of Object.keys(drawn)) {
        if (!wanted.has(id)) {
          removeOne(chart, candle, drawn[id]);
          delete drawn[id];
        }
      }
      for (const d of drawings) {
        if (drawn[d.id] && d.kind === "hline") continue;
        if (drawn[d.id]) {
          removeOne(chart, candle, drawn[d.id]);
          delete drawn[d.id];
        }
        const h = drawOne(chart, candle, d);
        if (h) drawn[d.id] = h;
      }
      return void 0;
    }, [drawings, candles, chartEpoch]);
    useEffect5(() => {
      const chart = chartRef.current, candle = candleRef.current;
      if (!chart || !candle) return void 0;
      const handles = layerHandlesRef.current;
      const removeGroup = (key) => {
        (handles[key] || []).forEach((h) => removeLayerHandle(chart, candle, h));
        delete handles[key];
      };
      for (const key of Object.keys(handles)) removeGroup(key);
      if (!candles.length) return void 0;
      const ctx = {
        chart,
        candle,
        LW: window.LightweightCharts,
        candles,
        layers: layerData && layerData.layers || {},
        forecast: forecastData,
        replay: replayData,
        position: positionData,
        selectedLevel,
        dayCalls: dayCallsData,
        price: layerData && layerData.layers && layerData.layers.price || candles[candles.length - 1].close
      };
      const keysToDraw = new Set(activeLayers);
      if (!replayShown) keysToDraw.delete("replay");
      else keysToDraw.add("replay");
      for (const key of keysToDraw) {
        if (!["forecast", "replay", "position", "calls"].includes(key) && !layerData) continue;
        const drawer = LAYER_DRAWERS[key];
        if (!drawer) continue;
        try {
          handles[key] = drawer(ctx) || [];
        } catch (e) {
          handles[key] = [];
        }
      }
      return void 0;
    }, [activeLayers, layerData, forecastData, replayData, replayShown, positionData, dayCallsData, selectedLevel, candles, chartEpoch]);
    useEffect5(() => {
      const chart = chartRef.current;
      const src = replayShown && replayData || callsOn && dayCallsData || null;
      if (!chart || !src || !candles.length) return;
      const ts = src.forecasts.map((f) => f.as_of_ts).filter((t) => t != null);
      if (!ts.length) return;
      const first = Math.min(...ts), lastT = Math.max(...ts);
      const c0 = candles[0].time, cN = candles[candles.length - 1].time;
      const pad = 2 * 3600;
      const from = Math.max(c0, first - pad), to = Math.min(cN, lastT + pad);
      if (to > from) {
        requestAnimationFrame(() => {
          try {
            chart.timeScale().setVisibleRange({ from, to });
          } catch (e) {
          }
        });
      }
    }, [replayData, replayShown, callsOn, dayCallsData, candles, chartEpoch]);
    const last = candles.length ? candles[candles.length - 1].close : null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-ic" }, /* @__PURE__ */ React.createElement("div", { className: "vg-ic-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-ic-sym" }, symbol), onOpenSymbol && /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "vg-ic-syminput",
        placeholder: "symbol\u2026",
        value: symInput,
        onChange: (e) => setSymInput(e.target.value.toUpperCase()),
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            const s = symInput.trim().toUpperCase();
            if (s && s !== symbol) onOpenSymbol(s);
            setSymInput("");
          }
        },
        "aria-label": "Change chart symbol"
      }
    ), last != null && /* @__PURE__ */ React.createElement("span", { className: "vg-ic-px" }, last), hover && /* @__PURE__ */ React.createElement("span", { className: cls("vg-ic-ohlc", hover.up ? "up" : "down") }, hover.lineOnly ? /* @__PURE__ */ React.createElement(React.Fragment, null, "C ", hover.c) : /* @__PURE__ */ React.createElement(React.Fragment, null, "O ", hover.o, " H ", hover.h, " L ", hover.l, " C ", hover.c)), /* @__PURE__ */ React.createElement("div", { className: "vg-ic-tf" }, TIMEFRAMES.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t,
        className: cls("vg-ic-tfb", t === tf && "on"),
        onClick: () => setTf(t)
      },
      t
    ))), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-ic-refresh", refreshing && "spin"),
        onClick: () => doRefresh(1),
        disabled: refreshing,
        title: `Refresh ${symbol} bars`,
        "aria-label": `Refresh ${symbol} bars`
      },
      "\u27F3"
    )), !compact && /* @__PURE__ */ React.createElement("div", { className: "vg-ic-inds" }, INDICATORS.map((ind) => {
      const disabled = ind.needsVol && !TF_HAS_VOLUME(tf);
      const on = active.has(ind.key) && !disabled;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: ind.key,
          className: cls("vg-ic-chip", on && "on", disabled && "off"),
          onClick: () => !disabled && toggleInd(ind.key),
          disabled,
          title: disabled ? `${ind.label} needs intraday volume (1m\u20134H)` : `Toggle ${ind.label}`
        },
        ind.label
      );
    }), /* @__PURE__ */ React.createElement("div", { className: "vg-ic-tools" }, TOOLS.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t.key,
        className: cls("vg-ic-tool", t.key === tool && "on"),
        onClick: () => {
          pendingRef.current = [];
          setPendingN(0);
          setTool(t.key);
        },
        title: t.title,
        "aria-label": t.title
      },
      t.label
    )), tool !== "cursor" && pendingN > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-ic-hint" }, pendingN, "/", TOOL_PTS[tool]), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-ic-tool",
        onClick: undoLastDrawing,
        disabled: !drawings.length,
        title: "Undo last drawing",
        "aria-label": "Undo last drawing"
      },
      "\u232B"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-ic-tool",
        onClick: clearDrawings,
        disabled: !drawings.length,
        title: "Clear all drawings",
        "aria-label": "Clear all drawings"
      },
      "\u2715"
    ))), !compact && /* @__PURE__ */ React.createElement("div", { className: "vg-ic-layers" }, /* @__PURE__ */ React.createElement("span", { className: "vg-ic-layers-tag" }, "DNA"), LAYERS.map((ly) => {
      const gatedLevels = ly.needsLevels && layerData && !layerData.has_levels;
      const gatedFc = ly.needsForecast && !fcQ.loading && !forecastData;
      const gatedPos = ly.needsPosition && !posQ.loading && !positionData;
      const gated = gatedLevels || gatedFc || gatedPos;
      const on = (ly.needsReplay ? replayActive : activeLayers.has(ly.key)) && !gated;
      const why = gatedFc ? `No stored forecast for this symbol yet` : gatedPos ? `Not held and no plan for this symbol` : ly.needsReplay ? `Replay \u2014 pick a run in the right panel` : gatedLevels ? `${ly.label} needs a coach playbook (SPX/QQQ/IWM)` : `Toggle ${ly.label}`;
      const onClick = ly.needsReplay ? () => {
        onReplayToggle && onReplayToggle();
      } : () => !gated && toggleLayer(ly.key);
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: ly.key,
          className: cls("vg-ic-chip", on && "on", gated && "off"),
          onClick,
          disabled: gated,
          title: why
        },
        ly.label
      );
    }), layerQ.loading && /* @__PURE__ */ React.createElement("span", { className: "vg-ic-hint" }, "\u2026"), REPLAY_SYMBOLS.includes(String(symbol || "").toUpperCase()) && onForecastNow && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-ic-chip vg-ic-forecast-now",
        onClick: () => onForecastNow(symbol),
        title: `Forecast ${symbol} forward from now to the close \u2014 asks the analyst`
      },
      "\u{1F52E} Forecast now"
    ), layerData && !layerData.has_levels && /* @__PURE__ */ React.createElement("span", { className: "vg-ic-layers-note" }, "bars-derived only (no coach chain)")), (replayShown || callsOn && dayCallsData) && /* @__PURE__ */ React.createElement("div", { className: "vg-ic-legend" }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "vg-lg-sw", style: { background: "rgba(124,92,255,0.95)" } }), " predicted path"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "vg-lg-sw", style: { background: `rgb(${chartTheme().upRgb.join(",")})` } }), " call hit"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { className: "vg-lg-sw", style: { background: `rgb(${chartTheme().downRgb.join(",")})` } }), " call missed")), /* @__PURE__ */ React.createElement("div", { className: "vg-ic-body" }, q.loading && /* @__PURE__ */ React.createElement(LoadBar, null), !hasLW() ? /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: 12 } }, "Chart engine didn't load.") : /* @__PURE__ */ React.createElement("div", { ref: elRef, className: "vg-ic-canvas", style: height ? { height } : void 0 }), !q.loading && !data && /* @__PURE__ */ React.createElement("div", { className: "vg-ic-empty" }, /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, q.data && q.data.note || `No chart data for ${symbol}.`), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => doRefresh(30), disabled: refreshing }, refreshing ? `Loading ${symbol}\u2026` : `Load ${symbol} data`))), replayShown && replayData && replayData.forecasts.length > 0 && /* @__PURE__ */ React.createElement(
      ReplayCompareTable,
      {
        forecasts: replayData.forecasts,
        activeId: activeCallId,
        setActiveId: setActiveCallId
      }
    ));
  }
  function ReplayCompareTable({ forecasts, activeId, setActiveId }) {
    const hhmm2 = (iso) => String(iso || "").slice(11, 16);
    const tone = (sc) => !sc ? "plain" : sc === "hit target" || sc === "direction correct" ? "good" : sc === "invalidated" || sc === "direction wrong" ? "bad" : "plain";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-ic-cmpwrap" }, /* @__PURE__ */ React.createElement("table", { className: "vg-fc-cmp" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "time"), /* @__PURE__ */ React.createElement("th", null, "@ px"), /* @__PURE__ */ React.createElement("th", null, "bias"), /* @__PURE__ */ React.createElement("th", null, "1"), /* @__PURE__ */ React.createElement("th", null, "2"), /* @__PURE__ */ React.createElement("th", null, "3"), /* @__PURE__ */ React.createElement("th", null, "4"), /* @__PURE__ */ React.createElement("th", null, "5"), /* @__PURE__ */ React.createElement("th", null, "target"), /* @__PURE__ */ React.createElement("th", null, "invalid"), /* @__PURE__ */ React.createElement("th", null, "result"))), /* @__PURE__ */ React.createElement("tbody", null, forecasts.map((f) => {
      const path = f.path || [];
      return /* @__PURE__ */ React.createElement(
        "tr",
        {
          key: f.id,
          className: cls("vg-fc-cmprow", activeId === f.id && "vg-fc-cmprow-on"),
          onMouseEnter: () => setActiveId && setActiveId(f.id),
          onMouseLeave: () => setActiveId && setActiveId(null)
        },
        /* @__PURE__ */ React.createElement("td", null, hhmm2(f.as_of)),
        /* @__PURE__ */ React.createElement("td", null, f.price_at),
        /* @__PURE__ */ React.createElement("td", { className: dirCls(f.bias === "up" ? 1 : f.bias === "down" ? -1 : 0) }, f.bias || "\u2014"),
        [0, 1, 2, 3, 4].map((i) => /* @__PURE__ */ React.createElement("td", { key: i, className: "vg-fc-cmpstep", title: path[i] ? path[i].note : "" }, path[i] ? path[i].price : "")),
        /* @__PURE__ */ React.createElement("td", null, f.target != null ? f.target : "\u2014"),
        /* @__PURE__ */ React.createElement("td", null, f.invalidation != null ? f.invalidation : "\u2014"),
        /* @__PURE__ */ React.createElement("td", null, f.verdict ? /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", tone(f.verdict)), style: { fontSize: 12 } }, f.verdict) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014"))
      );
    }))));
  }
  function InstrumentChartCard({
    symbol,
    defaultTf = "15m",
    overlays,
    height,
    replayActive,
    replayRunId,
    onReplayToggle,
    onForecastNow,
    forecastNonce,
    activeCallId,
    setActiveCallId,
    onOpenSymbol,
    initialLayers,
    compact,
    seriesType
  }) {
    const [tf, setTf] = useState5(defaultTf);
    return /* @__PURE__ */ React.createElement(
      InstrumentChart,
      {
        symbol,
        tf,
        setTf,
        overlays,
        height,
        replayActive,
        replayRunId,
        onReplayToggle,
        onForecastNow,
        forecastNonce,
        activeCallId,
        setActiveCallId,
        onOpenSymbol,
        initialLayers,
        compact,
        seriesType
      }
    );
  }

  // src/mira-render.jsx
  var { useMemo: useMemo2 } = React;
  function extractJson(text) {
    if (!text) return null;
    let raw = String(text).trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) raw = fence[1].trim();
    const start = raw.indexOf("{");
    if (start < 0) return null;
    let depth = 0, end = -1;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === "{") depth++;
      else if (raw[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  function validateMira(o) {
    if (!o || typeof o !== "object") return false;
    if (isSwot(o.swot)) return true;
    if (typeof o.headline === "string" && o.headline.trim()) return true;
    return Array.isArray(o.sections) && o.sections.some(isRenderableSection);
  }
  function parseMira(text) {
    const o = extractJson(text);
    if (!o || !validateMira(o)) return null;
    return normalize(o);
  }
  function isSwot(s) {
    if (!s || typeof s !== "object") return false;
    const quads = ["strengths", "weaknesses", "opportunities", "threats"];
    for (const q of quads) {
      if (!Array.isArray(s[q])) return false;
      if (s[q].some((it) => !it || typeof it.point !== "string")) return false;
    }
    return quads.some((q) => s[q].length > 0);
  }
  function isRenderableSection(s) {
    if (!s || typeof s !== "object") return false;
    switch (s.kind) {
      case "swot":
        return isSwot(s.swot);
      case "list":
      case "donext":
        return Array.isArray(s.items) && s.items.length > 0;
      case "keyvals":
      case "scorecard":
        return Array.isArray(s.rows) && s.rows.length > 0;
      case "callout":
      case "prose":
        return typeof s.text === "string" && s.text.trim().length > 0;
      default:
        return false;
    }
  }
  function normalize(o) {
    if (Array.isArray(o.sections)) return o;
    const sections = [];
    if (isSwot(o.swot)) sections.push({ kind: "swot", swot: o.swot });
    if (o.pattern) sections.push({ kind: "callout", title: "The pattern", text: String(o.pattern) });
    if (o.scores_read) sections.push({ kind: "prose", text: String(o.scores_read) });
    if (Array.isArray(o.do_next) && o.do_next.length) sections.push({ kind: "donext", items: o.do_next });
    return { headline: o.headline, sections };
  }
  var SWOT_QUADS = [
    { key: "strengths", kind: "s", title: "Strengths", tag: "keep" },
    { key: "weaknesses", kind: "w", title: "Weaknesses", tag: "fix" },
    { key: "opportunities", kind: "o", title: "Opportunities", tag: "capture" },
    { key: "threats", kind: "t", title: "Threats", tag: "guard" }
  ];
  function normItem(it) {
    return typeof it === "string" ? { point: it, cites: [] } : it || { point: "" };
  }
  function SwotQuad({ kind, title, tag, items }) {
    return /* @__PURE__ */ React.createElement("div", { className: cls("vg-swot-q", kind) }, /* @__PURE__ */ React.createElement("div", { className: "vg-swot-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-swot-badge" }, kind.toUpperCase()), /* @__PURE__ */ React.createElement("b", null, title), /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-swot-tag" }, tag)), items.length ? /* @__PURE__ */ React.createElement("ul", { className: "vg-swot-items" }, items.map(normItem).map((it, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement("span", null, it.point), Array.isArray(it.cites) && it.cites.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-swot-cites" }, it.cites.map((c, j) => /* @__PURE__ */ React.createElement("span", { key: j, className: cls("vg-cite", kind) }, c)))))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "4px 0 0", fontSize: 13 } }, "none noted this window"));
  }
  function SwotRender({ swot }) {
    const s = swot && swot.swot || swot || {};
    return /* @__PURE__ */ React.createElement("div", { className: "vg-swot vg-swot-grid" }, SWOT_QUADS.map((q) => /* @__PURE__ */ React.createElement(SwotQuad, { key: q.key, kind: q.kind, title: q.title, tag: q.tag, items: s[q.key] || [] })));
  }
  var TONE = { good: "vg-up", bad: "vg-down", warn: "vg-warn" };
  function Section({ s }) {
    if (s.kind === "swot") {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-section" }, s.title && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, s.title), /* @__PURE__ */ React.createElement(SwotRender, { swot: s.swot }));
    }
    if (s.kind === "prose") {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-section" }, s.title && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, s.title), /* @__PURE__ */ React.createElement("p", { className: "vg-mr-prose", style: { whiteSpace: "pre-wrap", margin: s.title ? "4px 0 0" : 0 } }, s.text));
    }
    if (s.kind === "callout") {
      return /* @__PURE__ */ React.createElement("div", { className: cls("vg-mr-callout", s.tone && `t-${s.tone}`) }, s.title && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { margin: 0 } }, s.title), /* @__PURE__ */ React.createElement("p", { style: { margin: s.title ? "4px 0 0" : 0 } }, s.text));
    }
    if (s.kind === "list") {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-section" }, s.title && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, s.title), /* @__PURE__ */ React.createElement("ul", { className: "vg-mr-list" }, s.items.map(normItem).map((it, i) => /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement("span", null, it.point), Array.isArray(it.cites) && it.cites.length > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-swot-cites" }, it.cites.map((c, j) => /* @__PURE__ */ React.createElement("span", { key: j, className: "vg-cite" }, c)))))));
    }
    if (s.kind === "donext") {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-section" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, s.title || "Do this next"), /* @__PURE__ */ React.createElement("ol", { className: "vg-donext" }, s.items.map((d, i) => {
        const item = typeof d === "string" ? { title: d } : d || {};
        return /* @__PURE__ */ React.createElement("li", { key: i }, /* @__PURE__ */ React.createElement("b", null, item.title), item.detail ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \u2014 ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, item.detail)) : null);
      })));
    }
    if (s.kind === "keyvals") {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-section" }, s.title && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, s.title), /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("tbody", null, s.rows.map((r, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", { style: { width: 110 } }, /* @__PURE__ */ React.createElement("b", null, r.k)), /* @__PURE__ */ React.createElement("td", { className: cls(r.tone && TONE[r.tone]) }, r.v))))));
    }
    if (s.kind === "scorecard") {
      const tone = (n) => n >= 70 ? "good" : n >= 45 ? "warn" : "bad";
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-section" }, s.title && /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, s.title), /* @__PURE__ */ React.createElement("div", { className: "vg-scores" }, s.rows.map((r, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-score" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, r.label), /* @__PURE__ */ React.createElement("b", { className: cls("vg-score-n", `vg-${tone(r.score)}`) }, r.score)), /* @__PURE__ */ React.createElement("div", { className: "vg-score-track" }, /* @__PURE__ */ React.createElement("div", { className: cls("vg-score-fill", `bg-${tone(r.score)}`), style: { width: `${Math.max(0, Math.min(100, r.score))}%` } }))))));
    }
    return null;
  }
  function MiraRender({ data, text }) {
    const obj = useMemo2(() => data || parseMira(text), [data, text]);
    if (!obj) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-mr-prose", style: { whiteSpace: "pre-wrap" } }, text || "");
    }
    const sections = obj.sections || [];
    return /* @__PURE__ */ React.createElement("div", { className: "vg-mr" }, obj.headline && /* @__PURE__ */ React.createElement("h3", { className: "vg-mr-headline" }, obj.headline), sections.filter(isRenderableSection).map((s, i) => /* @__PURE__ */ React.createElement(Section, { key: i, s })));
  }

  // src/cockpit.jsx
  var { useState: useState6, useEffect: useEffect6 } = React;
  var backend2 = () => (JSON.parse(localStorage.getItem("vantage-settings") || "{}").backendUrl || "http://127.0.0.1:8641").replace(/\/+$/, "");
  var getFrames = (day) => getJson(
    `${backend2()}/api/cockpit/frames${day ? `?day=${encodeURIComponent(day)}` : ""}`,
    { timeoutMs: 6e4 }
  );
  var todayET = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(/* @__PURE__ */ new Date());
  var etMinNow = () => {
    const [h, m] = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" }).format(/* @__PURE__ */ new Date()).split(":");
    return Number(h) * 60 + Number(m);
  };
  var money5 = (v) => v == null ? "\u2014" : `${v >= 0 ? "+" : "\u2212"}$${Math.abs(v).toLocaleString(void 0, { maximumFractionDigits: 0 })}`;
  function callSide(bias) {
    const s = String(bias || "").toLowerCase();
    if (s.includes("up") || s.includes("bull") || s.includes("long")) return "bullish";
    if (s.includes("down") || s.includes("bear") || s.includes("short")) return "bearish";
    return null;
  }
  var sideTone = (side) => side === "bullish" ? "good" : side === "bearish" ? "bad" : "plain";
  function verdictTone(v) {
    const s = String(v || "").toLowerCase();
    if (s.includes("hit") || s.includes("correct")) return "good";
    if (s.includes("invalid") || s.includes("wrong")) return "bad";
    return "plain";
  }
  var ageMin = (iso) => {
    try {
      return Math.round((Date.now() - new Date(iso).getTime()) / 6e4);
    } catch {
      return null;
    }
  };
  function levelState(call, price) {
    const side = callSide(call && call.bias);
    if (!side || price == null) return null;
    if (call.target != null && (side === "bullish" ? price >= call.target : price <= call.target)) return "target";
    if (call.invalidation != null && (side === "bullish" ? price <= call.invalidation : price >= call.invalidation)) return "invalidated";
    return null;
  }
  function flatAction(call, price) {
    const side = callSide(call && call.bias);
    if (!call) return { verb: "WAIT", tone: "plain", detail: "no analyst call yet" };
    if (call.born_invalid) return { verb: "WAIT", tone: "warn", detail: "call was invalid at birth \u2014 stand down" };
    if (!side) return { verb: "WAIT", tone: "plain", detail: "no directional edge in the call" };
    const st = levelState(call, price);
    if (st === "invalidated") return { verb: "WAIT", tone: "warn", detail: `call broken \u2014 ${call.invalidation} gave way` };
    if (st === "target") return { verb: "WAIT", tone: "warn", detail: `target ${call.target} already met \u2014 chasing is late` };
    return {
      verb: side === "bullish" ? "LOOK LONG" : "LOOK SHORT",
      tone: sideTone(side),
      detail: `toward ${call.target ?? "?"} \xB7 wrong beyond ${call.invalidation ?? "?"}`
    };
  }
  function positionAction(call, trade, price) {
    const side = callSide(call && call.bias);
    const aligned = side != null && trade.dir === side;
    if (!call || !side) return { verb: "HOLD", tone: "plain", detail: "no standing call to judge against" };
    if (!aligned) return { verb: "SELL", tone: "bad", detail: `call is ${side.toUpperCase()} \u2014 against your ${trade.dir} position` };
    const st = levelState(call, price);
    if (st === "invalidated") return { verb: "SELL", tone: "bad", detail: `invalidation ${call.invalidation} broke \u2014 thesis dead` };
    if (st === "target") return { verb: "SELL", tone: "good", detail: `target ${call.target} met \u2014 take the win` };
    if (call.fresh) return { verb: "HOLD / ADD", tone: "good", detail: `fresh call reaffirms ${side} \u2014 room to ${call.target ?? "?"}` };
    return { verb: "HOLD", tone: "good", detail: `aligned with the call \u2014 room to ${call.target ?? "?"}, out beyond ${call.invalidation ?? "?"}` };
  }
  var actionBadge = (a, big) => /* @__PURE__ */ React.createElement(
    "span",
    {
      className: cls("vg-badge", a.tone),
      style: { fontWeight: 700, ...big ? { fontSize: "var(--vg-text-md)", padding: "4px 10px" } : {} }
    },
    a.verb
  );
  function LevelChips({ call, price }) {
    if (!call) return null;
    const dist = (v) => price != null && v != null ? ` (${v - price >= 0 ? "+" : ""}${(v - price).toFixed(1)}pt)` : "";
    return /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 6, flexWrap: "wrap" } }, call.target != null && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good", style: { fontVariantNumeric: "tabular-nums" } }, "target ", call.target, dist(call.target)), call.invalidation != null && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad", style: { fontVariantNumeric: "tabular-nums" } }, "wrong ", call.invalidation, dist(call.invalidation)), (call.path || []).map((s, i) => /* @__PURE__ */ React.createElement(
      "span",
      {
        key: i,
        className: "vg-badge plain",
        style: { fontVariantNumeric: "tabular-nums" },
        title: s.note || ""
      },
      i + 1,
      "\xB7 ",
      s.price
    )));
  }
  function gapRead(gapPct) {
    if (gapPct == null) return null;
    const a = Math.abs(gapPct);
    if (a < 0.02) return null;
    const dir = gapPct > 0 ? "up" : "down";
    const fade = gapPct > 0 ? "shorting it" : "buying the dip";
    if (a < 0.2) return { tone: "good", text: `Opened ${gapPct > 0 ? "+" : ""}${gapPct}% \u2014 a small gap. These close the gap 8 times in 10, no strong lean either way.` };
    if (a < 0.5) return { tone: "plain", text: `Opened ${gapPct > 0 ? "+" : ""}${gapPct}% \u2014 a medium gap. Closes the gap about half the time; no edge fading it early.` };
    return { tone: "bad", text: `Opened ${gapPct > 0 ? "+" : ""}${gapPct}% \u2014 a BIG gap ${dir}. These keep going ${a >= 1 ? "7\u20138" : "6"} times in 10 in the first hour and close the gap only ${a >= 1 ? "2" : "3"} in 10. ${fade[0].toUpperCase() + fade.slice(1)} before 10:00 is fighting the odds.` };
  }
  function ChecklistCard({ d, planRows }) {
    const buckets = d.buckets || [];
    const last = buckets[buckets.length - 1];
    const price = last ? last.close : null;
    const etMin = etMinNow();
    const frames = d.frames || [];
    const call = (frames.find((f) => f.call) || {}).call;
    const side = callSide(call && call.bias);
    const age = call ? ageMin(call.as_of) : null;
    const trades = d.trades || [];
    const lastTrade = trades.length ? trades[trades.length - 1] : null;
    const lastEntryMin = lastTrade ? lastTrade.start_min : null;
    const items = [];
    const add = (tone, text) => items.push({ tone, text });
    if (last) {
      const st = last.session_tone;
      add(
        st === "flat" ? "plain" : "good",
        st === "bull" ? `Tape is UP ${last.session_ret_pct > 0 ? "+" : ""}${last.session_ret_pct}% on the day \u2014 longs swim with it, shorts fight it.` : st === "bear" ? `Tape is DOWN ${last.session_ret_pct}% on the day \u2014 shorts swim with it, longs fight it.` : "Tape is flat \u2014 no side has the ball; smaller size, quicker exits."
      );
    }
    const g = gapRead(d.gap_pct);
    if (g) add(g.tone, g.text);
    if (call) {
      if (call.born_invalid) add("bad", "The standing call was broken at birth \u2014 there is no analyst thesis right now. Stand down or wait for the next one.");
      else if (age != null && age > 20) add("warn", `The analyst call is ${age} minutes old \u2014 stale. Wait for the refresh before leaning on it.`);
      else add("good", `Analyst says ${side ? side.toUpperCase() : "NEUTRAL"}${call.target != null ? ` toward ${call.target}` : ""} (${age} min ago). Trading against it has cost real money this month.`);
    } else add("plain", "No analyst call yet this session.");
    const testing = (planRows || []).filter((r) => (r.role === "support" || r.role === "resistance") && price != null && price >= (r.lo != null ? r.lo : r.price) && price <= (r.hi != null ? r.hi : r.price));
    if (testing.length) {
      const z = testing[0];
      add("warn", `Price is INSIDE the ${z.lo != null ? `${z.lo}\u2013${z.hi}` : z.price} zone right now \u2014 it hasn't picked a side. Entering mid-zone is a coin flip; let it resolve.`);
    }
    if (etMin < 600) add("warn", "Opening window (before 10:00): 1 contract max, and never against the gap. The 09:39 five-lot cost $4,430.");
    else if (etMin >= 930) add("bad", "Past 15:30 \u2014 no new trades. Whatever this is, it can wait for tomorrow's plan.");
    if (d.day_pnl != null && d.day_pnl <= -2e3)
      add("bad", `Down ${money5(d.day_pnl)} \u2014 the $2,000 daily stop is HIT. The day is over; anything else is revenge trading.`);
    else if ((d.streak || 0) >= 3)
      add("bad", `${d.streak} losses in a row \u2014 step away from the screen for 15 minutes before the next entry.`);
    else if (d.day_pnl != null && d.day_pnl < 0)
      add("plain", `Down ${money5(d.day_pnl)} on the day \u2014 ${money5(-2e3 - d.day_pnl)} of room left before the hard stop.`);
    if (lastEntryMin != null && etMin - lastEntryMin >= 0 && etMin - lastEntryMin < 5)
      add("warn", `You entered ${etMin - lastEntryMin} min ago \u2014 no adding, no size-up for 5 minutes. Averaging into losers is how -$4,430 happens.`);
    const glyph = (t) => t === "good" ? "\u2713" : t === "bad" ? "\u2715" : "\u26A0";
    const col = (t) => t === "good" ? "var(--vg-up)" : t === "bad" ? "var(--vg-down)" : t === "warn" ? "var(--vg-warn)" : "var(--vg-faint)";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Before you trade", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \u2014 prefilled \xB7 code, never Mira")), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 7 } }, items.map((it, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "grid", gridTemplateColumns: "16px 1fr", gap: 8, alignItems: "start" } }, /* @__PURE__ */ React.createElement("b", { style: { color: col(it.tone), lineHeight: "1.4" } }, glyph(it.tone)), /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: "var(--vg-text-sm)",
      color: it.tone === "bad" ? "var(--vg-down)" : void 0
    } }, it.text)))));
  }
  function CarriedRulesCard() {
    const y = (() => {
      const d = /* @__PURE__ */ new Date();
      let n = 1;
      const dow = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
      if (dow === "Mon") n = 3;
      if (dow === "Sun") n = 2;
      d.setDate(d.getDate() - n);
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
    })();
    const q = useLive(() => getDayReviews(y), null, [y]);
    const rows = q.data && q.data.available && (q.data.reviews || q.data.rows) || [];
    const latest = rows.length ? rows[rows.length - 1] : null;
    const parsed = latest ? parseMira(latest.analysis || latest.review || "") : null;
    const donext = (parsed && parsed.sections || []).find((x) => x.kind === "donext");
    if (!donext || !(donext.items || []).length) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Carried from yesterday", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \xB7 ", y, " debrief")), /* @__PURE__ */ React.createElement("ol", { style: { margin: "2px 0 0", paddingLeft: 16, fontSize: "var(--vg-text-sm)" } }, donext.items.slice(0, 3).map((it, i) => /* @__PURE__ */ React.createElement("li", { key: i, style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("b", null, it.title || it.point), it.detail && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \u2014 ", String(it.detail).slice(0, 140))))));
  }
  function MiraCallBlock({ row, title }) {
    if (!row || !row.forecast_text) return null;
    const parsed = parseMira(row.forecast_text);
    return /* @__PURE__ */ React.createElement("div", { style: { borderLeft: "3px solid #7c5cff", paddingLeft: 10, marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { color: "#7c5cff", marginBottom: 2 } }, title || "The call, in Mira's words", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \xB7 verbatim")), /* @__PURE__ */ React.createElement("details", null, /* @__PURE__ */ React.createElement("summary", { className: "vg-note", style: { cursor: "pointer", fontWeight: 600 } }, parsed && parsed.headline || String(row.forecast_text).slice(0, 110)), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement(MiraRender, { data: parsed, text: row.forecast_text }))));
  }
  function LevelsWatch({ d, rows }) {
    const buckets = d.buckets || [];
    const price = buckets.length ? buckets[buckets.length - 1].close : null;
    const sr = (rows || []).filter((r) => r.role === "support" || r.role === "resistance");
    if (!sr.length || price == null) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { marginTop: 12, padding: "10px 12px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 6 } }, "Levels watch", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \u2014 plan vs now (last ", price, ")")), /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Level"), /* @__PURE__ */ React.createElement("th", null, "Plan"), /* @__PURE__ */ React.createElement("th", null, "Now"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, sr.map((r, i) => {
      const lo = r.lo != null ? r.lo : r.price;
      const hi = r.hi != null ? r.hi : r.price;
      const now = price > hi ? "support" : price < lo ? "resistance" : "testing";
      const flip = now !== "testing" && now !== r.role;
      return /* @__PURE__ */ React.createElement("tr", { key: i, style: flip ? { background: "var(--vg-raised)" } : void 0 }, /* @__PURE__ */ React.createElement(
        "td",
        {
          className: "num",
          style: { textAlign: "left" },
          title: r.hi != null && r.hi > r.lo ? `zone ${r.lo}\u2013${r.hi}` : void 0
        },
        r.hi != null && r.hi > r.lo ? `${r.lo}\u2013${r.hi}` : r.price,
        /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontFamily: "var(--vg-font-ui)", fontSize: "var(--vg-text-xs)", whiteSpace: "normal" } }, String(r.label || "").replace(/\s*[★✦].*$/, ""))
      ), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", r.role === "support" ? "good" : "bad") }, r.role.slice(0, 3))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls(
        "vg-badge",
        now === "support" ? "good" : now === "resistance" ? "bad" : "warn"
      ) }, now === "testing" ? "testing" : now.slice(0, 3))), /* @__PURE__ */ React.createElement("td", null, flip && /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "vg-badge warn",
          style: { fontWeight: 700 },
          title: "price traded through the whole zone \u2014 the plan's role has inverted"
        },
        "FLIP"
      )));
    }))));
  }
  function NowCard({ d, isToday }) {
    const frames = d.frames || [];
    const latest = frames.find((f) => f.call);
    const call = latest && latest.call;
    const fq = useLive(() => getSpxForecasts(void 0, "SPX", 1), null, [call && call.id]);
    const fRow = fq.data && fq.data.available && (fq.data.forecasts || [])[0] || null;
    const fMatch = fRow && call && fRow.id === call.id ? fRow : null;
    const buckets = d.buckets || [];
    const price = buckets.length ? buckets[buckets.length - 1].close : null;
    const openTrades = (d.trades || []).filter((t) => t.realized == null);
    const side = callSide(call && call.bias);
    const age = call ? ageMin(call.as_of) : null;
    const etMin = etMinNow();
    const closed = !isToday || etMin >= 960 || etMin < 570;
    const stale = isToday && !closed && age != null && age > 20;
    const flat = flatAction(call, price);
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", flexWrap: "wrap", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, closed ? "Session closed \u2014 final call" : "Next 15 minutes"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, call ? `@ ${call.minute} from ${call.price_at ?? "?"}` : "no call yet", !closed && age != null ? ` \xB7 ${age}m ago` : "", stale && /* @__PURE__ */ React.createElement("b", { className: "vg-down" }, " \xB7 STALE"))), call ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 8, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", sideTone(side)),
        style: { fontSize: "var(--vg-text-lg)", fontWeight: 800, padding: "5px 12px" }
      },
      side ? side.toUpperCase() : "NEUTRAL"
    ), call.born_invalid && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "BORN-INVALID"), price != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontVariantNumeric: "tabular-nums" } }, "last ", price)), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(LevelChips, { call, price })), /* @__PURE__ */ React.createElement(MiraCallBlock, { row: fMatch }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, display: "grid", gap: 6 } }, closed ? /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Market closed \u2014 nothing to act on.") : openTrades.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "baseline" } }, actionBadge(flat, true), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, flat.detail)) : openTrades.map((t, i) => {
      const a = positionAction(call, t, price);
      return /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-row", style: { gap: 8, alignItems: "baseline", flexWrap: "wrap" } }, actionBadge(a, true), /* @__PURE__ */ React.createElement("b", { style: { fontSize: "var(--vg-text-sm)" } }, t.label), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", t.dir === "bullish" ? "good" : "bad") }, t.dir), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, a.detail));
    }))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 6 } }, "Waiting for the first analyst call of the session."));
  }
  function DisciplineCard({ d }) {
    const hasAny = d.verdict || (d.commentary || []).length || d.day_pnl != null;
    if (!hasAny) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Discipline", /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-note",
        style: { fontWeight: 400 },
        title: "deterministic rules over your fills + 1m bars: daily stop, loss streak, with/against alignment"
      },
      " \xB7 code, never Mira"
    )), d.day_pnl != null && /* @__PURE__ */ React.createElement(
      "b",
      {
        className: d.day_pnl >= 0 ? "vg-up" : "vg-down",
        style: { fontVariantNumeric: "tabular-nums" }
      },
      money5(d.day_pnl)
    )), d.verdict && /* @__PURE__ */ React.createElement("div", { className: "vg-tone-verdict", style: { marginTop: 8 } }, "\u26A0 ", d.verdict), (d.commentary || []).map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-tone-note", style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-tone-notedot", c.tone) }), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: {
      fontSize: "var(--vg-text-sm)",
      color: c.tone === "bad" ? "var(--vg-down)" : void 0
    } }, c.text))));
  }
  function FrameBriefing({ sel, onClear }) {
    const day = sel.day;
    const trades = sel.trades || [];
    const aq = useLive(
      () => trades.length ? getTradeAnalyses(day) : Promise.resolve(null),
      null,
      [day, trades.length]
    );
    const analyses = aq.data && aq.data.available && aq.data.analyses || [];
    const fq = useLive(
      () => sel.call ? getSpxForecasts(day, "SPX", 60) : Promise.resolve(null),
      null,
      [day, sel.call && sel.call.id]
    );
    const fRow = sel.call ? (fq.data && fq.data.available && fq.data.forecasts || []).find((r) => r.id === sel.call.id) : null;
    const forTrade = (t) => t.opened_at && analyses.find((r) => String(r.trade_key || "").startsWith(`${t.opened_at}|`)) || analyses.find((r) => r.label === t.label) || null;
    const c = sel.call, m = sel.market;
    const side = callSide(c && c.bias);
    const act = flatAction(c, m ? m.close : null);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Frame ", sel.t, day ? ` \xB7 ${day}` : ""), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: onClear, title: "Collapse this briefing" }, "\u2715 close")), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, c ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", sideTone(side)), style: { fontWeight: 700 } }, side ? side.toUpperCase() : "NEUTRAL"), actionBadge(act), c.born_invalid && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "BORN-INVALID"), c.score && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", verdictTone(c.score.verdict)) }, c.score.verdict, c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : "")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(LevelChips, { call: c, price: m ? m.close : null })), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 6 } }, "call made ", c.minute, " @ ", c.price_at, m ? ` \xB7 frame closed ${m.close} (${m.ret_pct > 0 ? "+" : ""}${m.ret_pct}%)` : ""), /* @__PURE__ */ React.createElement(MiraCallBlock, { row: fRow })) : /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "No analyst call stood in this frame.")), trades.map((t, i) => {
      const aligned = side != null ? t.dir === side : null;
      const r = forTrade(t);
      const parsed = r ? parseMira(r.analysis) : null;
      return /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-card", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "baseline", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("b", { style: { fontSize: "var(--vg-text-sm)" } }, t.time, " \u2014 ", t.label), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", t.dir === "bullish" ? "good" : "bad") }, t.dir), aligned != null && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", aligned ? "good" : "bad") }, aligned ? "\u2713 with the call" : "\u2717 against the call"), t.realized != null ? /* @__PURE__ */ React.createElement("b", { className: t.realized >= 0 ? "vg-up" : "vg-down" }, money5(t.realized)) : /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "open")), r ? /* @__PURE__ */ React.createElement("details", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("summary", { className: "vg-note", style: { cursor: "pointer" } }, parsed && parsed.headline || String(r.analysis || "").slice(0, 100)), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement(MiraRender, { data: parsed, text: r.analysis }))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 6 } }, t.realized == null ? "Desk review lands after the trade closes." : "Desk review pending \u2014 the auto-loop drains 2 per tick."));
    }), !trades.length && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10 } }, "No trades in this frame."));
  }
  function CockpitPanel({ refreshNonce }) {
    const [tick, setTick] = useState6(0);
    useEffect6(() => {
      const t = setInterval(() => {
        const m = etMinNow();
        if (m >= 540 && m <= 965) setTick((n) => n + 1);
      }, 12e4);
      return () => clearInterval(t);
    }, []);
    const q = useLive(() => getFrames(void 0), null, [tick, refreshNonce]);
    const d = q.data && q.data.available ? q.data : null;
    const pq = useLive(() => getJson(`${backend2()}/api/spx/playbook?symbol=SPX`, { timeoutMs: 3e4 }), null, [refreshNonce]);
    const planRows = ((pq.data && pq.data.available && pq.data.scaffold || {}).table || {}).rows || [];
    const preOpen = etMinNow() < 570;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, preOpen && /* @__PURE__ */ React.createElement(CarriedRulesCard, null), d && !preOpen && /* @__PURE__ */ React.createElement(NowCard, { d, isToday: true }), d && !preOpen && /* @__PURE__ */ React.createElement(ChecklistCard, { d, planRows }), /* @__PURE__ */ React.createElement(AlertsBlock, { refreshNonce }), d && /* @__PURE__ */ React.createElement(LevelsWatch, { d, rows: planRows }), d && /* @__PURE__ */ React.createElement(DisciplineCard, { d }), !d && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 12 } }, q.loading ? "Reading the day\u2026" : "Cockpit needs the SQLite backend."));
  }
  function FrameTr({ f, selected, onSelect }) {
    const c = f.call, m = f.market;
    const side = callSide(c && c.bias);
    const act = flatAction(c, m ? m.close : null);
    const trades = f.trades || [];
    const faded = c && !c.fresh ? { opacity: 0.45 } : void 0;
    const bg = selected ? { background: "var(--vg-raised)", boxShadow: "inset 2px 0 0 var(--vg-accent, currentColor)" } : trades.length ? { background: "var(--vg-raised)" } : void 0;
    return /* @__PURE__ */ React.createElement(
      "tr",
      {
        className: "click",
        onClick: () => onSelect(f),
        style: bg,
        title: "open this frame's briefing in the right panel"
      },
      /* @__PURE__ */ React.createElement("td", { className: "num", style: { textAlign: "left" } }, f.t),
      /* @__PURE__ */ React.createElement("td", { style: faded }, c ? /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 5, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", sideTone(side)), style: { fontWeight: 700 } }, side ? side.toUpperCase() : "NEUTRAL"), c.fresh && /* @__PURE__ */ React.createElement("span", { className: "vg-fr-fresh", title: `new call this frame @ ${c.minute}` })) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")),
      /* @__PURE__ */ React.createElement("td", null, c ? /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", act.tone), style: { fontWeight: 700 }, title: act.detail }, act.verb) : null),
      /* @__PURE__ */ React.createElement("td", { className: "num", style: faded }, c && c.target != null ? c.target : "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: "num", style: faded }, c && c.invalidation != null ? c.invalidation : "\u2014"),
      /* @__PURE__ */ React.createElement("td", { className: "num", title: m ? `close ${m.close}` : "" }, m ? /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 5, alignItems: "center", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-tone-cellmini", m.tone) }), /* @__PURE__ */ React.createElement("span", null, m.ret_pct > 0 ? "+" : "", m.ret_pct, "%")) : "\u2014"),
      /* @__PURE__ */ React.createElement("td", null, c && c.score ? /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", verdictTone(c.score.verdict)), style: { fontSize: "var(--vg-text-xs)" } }, c.score.verdict, c.score.moved_pt != null ? ` ${c.score.moved_pt > 0 ? "+" : ""}${c.score.moved_pt}pt` : "") : c && c.fresh ? /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: "var(--vg-text-xs)" } }, "resolving\u2026") : null),
      /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 5, flexWrap: "wrap" } }, trades.map((t, i) => {
        const aligned = side != null ? t.dir === side : null;
        return /* @__PURE__ */ React.createElement(
          "span",
          {
            key: i,
            className: cls("vg-badge", aligned === false ? "bad" : aligned ? "good" : "plain"),
            title: `${t.time} \xB7 ${t.dir}${t.realized != null ? ` \xB7 ${money5(t.realized)}` : " \xB7 open"}`
          },
          aligned === false ? "\u2717" : aligned ? "\u2713" : "\xB7",
          " ",
          t.label
        );
      }))),
      /* @__PURE__ */ React.createElement("td", { className: "num" }, f.frame_pnl != null && f.frame_pnl !== 0 ? /* @__PURE__ */ React.createElement("b", { className: f.frame_pnl >= 0 ? "vg-up" : "vg-down" }, money5(f.frame_pnl)) : "")
    );
  }
  function CockpitView({ refreshNonce }) {
    const [day, setDay] = useState6(todayET());
    const isToday = day === todayET();
    const preOpen = isToday && etMinNow() < 570;
    const [tick, setTick] = useState6(0);
    useEffect6(() => {
      if (!isToday) return void 0;
      const t = setInterval(() => {
        const m = etMinNow();
        if (m >= 540 && m <= 965) setTick((n) => n + 1);
      }, 12e4);
      return () => clearInterval(t);
    }, [isToday]);
    const q = useLive(() => getFrames(day), null, [day, tick, refreshNonce]);
    const d = q.data && q.data.available ? q.data : null;
    const [chartMode, setChartMode] = useState6("fit");
    const chartBig = chartMode === "big";
    const [sel, setSel] = useState6(null);
    const select = (f) => setSel((prev) => prev && prev.t === f.t && prev.day === day ? null : { ...f, day });
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", flexWrap: "wrap", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 15 } }, "Cockpit"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "the market \xB7 the analyst's calls \xB7 you")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, alignItems: "baseline" } }, isToday && etMinNow() >= 570 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        onClick: () => setChartMode(chartBig ? "fit" : "big"),
        title: chartBig ? "Back to the fitted line chart" : "Expand: full height, candles, full toolbar"
      },
      chartBig ? "\u26F6 fit" : "\u26F6 expand"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        onClick: () => setChartMode(chartMode === "hidden" ? "fit" : "hidden"),
        title: "Collapse/show the chart \u2014 the log and the right pane carry the same story"
      },
      chartMode === "hidden" ? "show chart" : "hide chart"
    )), d && d.day_pnl != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "day ", /* @__PURE__ */ React.createElement("b", { className: d.day_pnl >= 0 ? "vg-up" : "vg-down" }, money5(d.day_pnl))), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        className: "vg-scan-filter",
        value: day,
        max: todayET(),
        onChange: (e) => {
          setDay(e.target.value || todayET());
          setSel(null);
        },
        "aria-label": "Cockpit day"
      }
    ))), preOpen && /* @__PURE__ */ React.createElement(PlanHalf, { refreshNonce }), isToday && !preOpen && chartMode !== "hidden" && /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8, padding: 8 } }, /* @__PURE__ */ React.createElement(
      InstrumentChartCard,
      {
        symbol: "SPX",
        defaultTf: "5m",
        compact: !chartBig,
        seriesType: chartBig ? "candles" : "line",
        height: chartBig ? Math.max(480, window.innerHeight - 220) : Math.max(460, Math.round(window.innerHeight * 0.55)),
        initialLayers: ["levels", "forecast", "calls"]
      }
    )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: "3 1 640px", minWidth: 0 } }, /* @__PURE__ */ React.createElement(ToneCompareCard, { marketOpen: isToday, day: isToday ? void 0 : day, slim: true }), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { marginTop: 14, padding: "10px 14px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 6 } }, "Every 15 minutes", d ? ` \xB7 ${d.frames.length} frames` : "", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \u2014 newest first \xB7 click a row for its briefing \xB7 \u2713 with / \u2717 against the call")), d && d.frames.length > 0 && /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Time"), /* @__PURE__ */ React.createElement("th", null, "Call"), /* @__PURE__ */ React.createElement("th", null, "Action"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Target"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Wrong if"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Market"), /* @__PURE__ */ React.createElement("th", null, "Resolved"), /* @__PURE__ */ React.createElement("th", null, "You"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "P&L"))), /* @__PURE__ */ React.createElement("tbody", null, d.frames.map((f) => /* @__PURE__ */ React.createElement(
      FrameTr,
      {
        key: f.t,
        f,
        onSelect: select,
        selected: !!sel && sel.t === f.t && sel.day === day
      }
    )))), d && !d.frames.length && /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "No frames for ", day, " \u2014 no stored bars or fills."), !d && /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, q.loading ? "Building the briefing\u2026" : "Cockpit needs the SQLite backend."))), sel && /* @__PURE__ */ React.createElement("div", { style: { flex: "2 1 400px", minWidth: 0, marginTop: 14, position: "sticky", top: 8 } }, /* @__PURE__ */ React.createElement(FrameBriefing, { sel, onClear: () => setSel(null) }))), isToday && /* @__PURE__ */ React.createElement(OpsBlock, null), isToday && !preOpen && /* @__PURE__ */ React.createElement(PlanHalf, { refreshNonce }));
  }
  function OpsBlock() {
    const [status, setStatus] = useState6(null);
    const [perf, setPerf] = useState6(null);
    const [nightly, setNightly] = useState6(null);
    const [spot, setSpot] = useState6(null);
    const [ticket, setTicket] = useState6(null);
    const load = async () => {
      const [s, p, n, b] = await Promise.all([
        getBotStatus(),
        getBotPerformance(),
        getNightlyStatus(1),
        getPlaybook(null)
      ]);
      setStatus(s && s.available !== false ? s : null);
      setPerf(p && p.available !== false ? p : null);
      setNightly(n && n.available && n.runs && n.runs.length ? n.runs[0] : null);
      setSpot(b && b.available && b.scaffold && b.scaffold.regime && b.scaffold.regime.spot || null);
    };
    useEffect6(() => {
      load();
    }, []);
    useEffect6(() => {
      if (!status || !status.market_open) return void 0;
      const t = setInterval(load, 6e4);
      return () => clearInterval(t);
    }, [status && status.market_open]);
    if (!status) return null;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(
      SignalsCard,
      {
        live: status.live_signals || [],
        armed: status.armed || [],
        spot,
        onExecute: (t) => setTicket({
          sym: t.symbol,
          spot,
          seed: {
            level: t.spy_level,
            entry: t.spy_entry,
            role: t.side === "long" ? "support" : "resistance"
          },
          signalId: t.id
        })
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-stats", style: { marginTop: 14, gridTemplateColumns: "1fr 1fr" } }, /* @__PURE__ */ React.createElement(StrategyCard, { perf }), /* @__PURE__ */ React.createElement(MachineCard, { run: nightly })), ticket && /* @__PURE__ */ React.createElement(
      TicketModal,
      {
        sym: ticket.sym,
        spot: ticket.spot,
        seed: ticket.seed,
        signalPaperId: ticket.signalId,
        onClose: () => setTicket(null)
      }
    ));
  }

  // src/notebook.jsx
  var { useState: useState7, useMemo: useMemo3, useEffect: useEffect7 } = React;
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
  function nearest2(levels, price) {
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
    const [saveNonce, setSaveNonce] = useState7(0);
    const nbReload = useLive(() => getNotebook(sym).then(mapNotebook), null, [sym, saveNonce]);
    const nbData = nbReload.data || notebook;
    const held = useMemo3(
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
    const { res, sup } = price != null ? nearest2(overlay && overlay.levels, price) : { res: null, sup: null };
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
      Section2,
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
      Section2,
      {
        title: "AI recommendation",
        summary: decision ? decision.recommendation : "not journaled"
      },
      decision ? /* @__PURE__ */ React.createElement(React.Fragment, null, decision.rationale && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, lineHeight: 1.5, margin: "0 0 0" } }, decision.rationale), hasLegs && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontWeight: 600, marginBottom: 6 } }, "Option legs"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, decision.legActions.map((a, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-nb-leg" }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", LEG_TONE[a.action] || "plain") }, LEG_TEXT[a.action] || a.action), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, a.side, " $", Number(a.strike).toFixed(0), (a.optionType || "")[0].toUpperCase(), " \xB7 ", a.dte, "DTE \xB7 ", a.moneyness)), a.rationale && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 3 } }, a.rationale)))))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Not in the latest decision journal. Run the nightly analysis to include ", sym, ".")
    ), /* @__PURE__ */ React.createElement(
      Section2,
      {
        title: "Valuation",
        summary: f && f.pe != null ? `P/E ${f.pe.toFixed(1)}` : price != null ? "levels" : "\u2014"
      },
      price != null ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, lineHeight: 1.6 } }, res ? /* @__PURE__ */ React.createElement("div", null, "Nearest resistance ", /* @__PURE__ */ React.createElement("b", null, usd(res.price, 2)), " (str ", res.strength, ") \u2014 ", signPct((res.price - price) / price * 100, 1), " away") : /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "No resistance above current price."), sup && /* @__PURE__ */ React.createElement("div", null, "Nearest support ", /* @__PURE__ */ React.createElement("b", null, usd(sup.price, 2)), " (str ", sup.strength, ") \u2014 ", signPct((sup.price - price) / price * 100, 1), " away")) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Technical levels unavailable (no bars)."),
      f && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-fund", style: { marginTop: 10 } }, f.market_cap != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Mkt cap"), " ", fmtBig(f.market_cap)), f.pe != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "P/E"), " ", f.pe.toFixed(1)), f.target_mean != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Target"), " ", usd(f.target_mean, 2), price != null && ` (${signPct((f.target_mean - price) / price * 100, 0)})`), f.week52_low != null && f.week52_high != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "52w"), " ", usd(f.week52_low, 0), "\u2013", usd(f.week52_high, 0)), f.forward_pe != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Fwd P/E"), " ", f.forward_pe.toFixed(1)), f.dividend_yield != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Yield"), " ", f.dividend_yield.toFixed(2), "%"), f.beta != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Beta"), " ", f.beta.toFixed(2))),
      g && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-fund", style: { marginTop: 10 } }, g.revenue_yoy != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Rev YoY"), " ", pct0(g.revenue_yoy)), g.gross_margin != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Gross mgn"), " ", pct0(g.gross_margin)), g.fcf_margin != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "FCF mgn"), " ", pct0(g.fcf_margin)), g.rule_of_40 != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: g.rule_of_40 >= 40 ? "vg-pos" : "vg-neg" }, "Rule of 40"), " ", g.rule_of_40.toFixed(0)), g.sbc_pct_revenue != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "SBC/rev"), " ", pct0(g.sbc_pct_revenue))),
      ex && ex.implied && ex.implied.status === "ok" && ex.implied.fcf_growth_10y != null && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.5, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Market implies"), " ", /* @__PURE__ */ React.createElement("b", null, pct0(ex.implied.fcf_growth_10y)), " FCF growth/yr for 10y", ex.assumptions && ` (r ${pct0(ex.assumptions.discount_rate)}, term ${pct1(ex.assumptions.terminal_growth)})`, g && g.growth && g.revenue_yoy != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \u2014 vs ", pct0(g.revenue_yoy), " actual rev growth")),
      ex && ex.implied && ex.implied.status === "negative_fcf" && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 13, marginTop: 8 } }, "Implied growth undefined (negative FCF)."),
      rs && rs.idio_r_1m != null && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.5, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "1m move"), " ", /* @__PURE__ */ React.createElement("b", { className: rs.r_1m >= 0 ? "vg-pos" : "vg-neg" }, signPct(rs.r_1m * 100, 1)), rs.beta_spy != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 \u03B2 ", rs.beta_spy.toFixed(2)), " \xB7 ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "idiosyncratic"), " ", /* @__PURE__ */ React.createElement("b", { className: rs.idio_r_1m >= 0 ? "vg-pos" : "vg-neg" }, signPct(rs.idio_r_1m * 100, 1)), rs.sector_etf && rs.sector_r_1m != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " (sector ", rs.sector_etf, " ", signPct(rs.sector_r_1m * 100, 1), ")"))
    ), /* @__PURE__ */ React.createElement(NewsSection, { news }), /* @__PURE__ */ React.createElement(
      Section2,
      {
        title: "My plan",
        summary: rr && rr.rr_ratio != null ? `R:R ${rr.rr_ratio.toFixed(2)}` : nbData && nbData.plan && nbData.plan.thesis ? "set" : "empty",
        plain: true
      },
      rr && rr.status === "ok" && rr.rr_ratio != null && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, lineHeight: 1.6, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Risk/reward"), " ", /* @__PURE__ */ React.createElement("b", null, rr.rr_ratio.toFixed(2), ":1"), rr.direction === "short" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " (short)"), " \xB7 ", /* @__PURE__ */ React.createElement("span", { className: "vg-pos" }, "+", usd(rr.upside, 2)), " to target", " / ", /* @__PURE__ */ React.createElement("span", { className: "vg-neg" }, "\u2212", usd(rr.downside, 2)), " to stop", rr.upside_pct != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " (", signPct(rr.upside_pct, 0), " / ", signPct(-rr.downside_pct, 0), ")")),
      rr && (rr.status === "stop_breached" || rr.status === "target_reached") && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 13, marginBottom: 8 } }, "Plan ", rr.status === "stop_breached" ? "stop breached" : "target reached", " at current price."),
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
      Section2,
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
  function Section2({ title, summary, children, plain, open = false }) {
    return /* @__PURE__ */ React.createElement("details", { className: "vg-nb-section", open }, /* @__PURE__ */ React.createElement("summary", { className: "vg-nb-summary" }, /* @__PURE__ */ React.createElement("span", { className: "vg-nb-sumtitle" }, title), summary != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-nb-sumval" }, summary)), /* @__PURE__ */ React.createElement("div", { className: plain ? "vg-nb-secbody plain" : "vg-nb-secbody" }, children));
  }
  function NewsSection({ news }) {
    const items = news && news.items ? news.items : [];
    const band = news && news.sentiment ? news.sentiment.band : null;
    const tone = band === "positive" ? "good" : band === "negative" ? "bad" : "plain";
    return /* @__PURE__ */ React.createElement(
      Section2,
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
    const [thesis, setThesis] = useState7("");
    const [target, setTarget] = useState7("");
    const [stop, setStop] = useState7("");
    const [notes, setNotes] = useState7("");
    const [saving, setSaving] = useState7(false);
    const [note, setNote] = useState7(null);
    useEffect7(() => {
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
    const [draft, setDraft] = useState7("");
    const [busy, setBusy] = useState7(false);
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
  function AmbientBrief() {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(/* @__PURE__ */ new Date());
    const volQ = useLive(() => getOdteRead("SPY"), null, []);
    const pnlQ = useLive(() => getDayPnl([today]), null, []);
    const v = volQ.data && volQ.data.available ? volQ.data : null;
    const p = pnlQ.data && pnlQ.data.available && pnlQ.data.pnl ? pnlQ.data.pnl[today] : null;
    if (!v && !p) return null;
    const tone = v && (v.verdict === "SELL PREMIUM" ? "good" : v.verdict === "BUY / LONG VOL" ? "warn" : "plain");
    return /* @__PURE__ */ React.createElement("div", { className: "vg-nb-ambient" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 6 } }, "Today at a glance"), v && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-ambrow" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "0DTE vol"), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", tone), style: { fontSize: "var(--vg-text-xs)", fontWeight: 700 } }, v.degraded ? "\u26A0 " : "", v.verdict), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontVariantNumeric: "tabular-nums" } }, v.implied_move_pct, "% priced vs ", v.realized_med_pct ?? "\u2014", "% delivered")), p && p.has_fills && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-ambrow" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "today"), /* @__PURE__ */ React.createElement(
      "b",
      {
        className: p.realized >= 0 ? "vg-up" : "vg-down",
        style: { fontVariantNumeric: "tabular-nums" }
      },
      `${p.realized >= 0 ? "+" : "\u2212"}$${Math.abs(p.realized).toLocaleString()}`
    ), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, p.trades, " decisions"), /* @__PURE__ */ React.createElement("a", { className: "vg-linkbtn", href: "#/journal" }, "journal \u2192")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: "var(--vg-text-xs)", marginTop: 4, opacity: 0.7 } }, "context, not signals \xB7 full read on the ", /* @__PURE__ */ React.createElement("a", { className: "vg-linkbtn", href: "#/cockpit" }, "Cockpit")));
  }
  var FACET_CHIPS = [
    { key: "full", label: "Full analysis", q: "What should I do about {S}?" },
    { key: "technical", label: "Technical", q: "Give me the technical / market read on {S}." },
    { key: "fundamental", label: "Fundamental", q: "How is {S} valued fundamentally?" },
    { key: "news", label: "News", q: "What's the recent news and sentiment on {S}?" },
    { key: "options", label: "Options", q: "What should I do with my {S} options?" }
  ];
  function AskCard({ sym, price, unrl, isHeld, decision, shares, hasLegs }) {
    const [msgs, setMsgs] = useState7([]);
    const [draft, setDraft] = useState7("");
    const [busy, setBusy] = useState7(false);
    const bodyRef = React.useRef(null);
    const abortRef = React.useRef(null);
    useEffect7(() => {
      setMsgs([]);
      setDraft("");
      setBusy(false);
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
      }
    }, [sym]);
    useEffect7(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs]);
    useEffect7(() => () => {
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-nb-ask" }, msgs.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-nb-empty" }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "0 0 10px" } }, "Ask Mira about ", sym, isHeld ? ` \u2014 your ${shares ? `${Math.round(shares)}-share ` : ""}position` : "", price != null ? ` at ${usd(price, 2)}` : "", ". Every answer is a multi-facet read (technical \xB7 fundamental \xB7 news \xB7 position), grounded in the Vantage engine."), /* @__PURE__ */ React.createElement("div", { className: "vg-nb-facets" }, FACET_CHIPS.filter((c) => c.key !== "options" || hasLegs).map((c) => /* @__PURE__ */ React.createElement("button", { key: c.key, className: "vg-facet-chip", onClick: () => ask(c.q.replace("{S}", sym)) }, c.label))), /* @__PURE__ */ React.createElement(AmbientBrief, null)) : /* @__PURE__ */ React.createElement("div", { className: "vg-nb-chat", ref: bodyRef }, msgs.map((m, i) => {
      const fmt2 = m.who === "ai" && !m.pending && m.mode !== "analyze" ? formatReply(m.text) : null;
      const body = fmt2 && typeof fmt2 === "object" ? fmt2.text : fmt2 || m.text;
      return /* @__PURE__ */ React.createElement("div", { key: i, className: cls("vg-msg", m.who) }, m.plan && m.plan.length > 0 && m.pending && /* @__PURE__ */ React.createElement("div", { className: "vg-msg-plan" }, m.plan.map((s, j) => /* @__PURE__ */ React.createElement("div", { key: j }, "\xB7 ", s))), m.pending && m.mode === "analyze" && /* @__PURE__ */ React.createElement("div", { className: "vg-msg-plan" }, "\xB7 fanning across technical \xB7 fundamental \xB7 news \xB7 position\u2026"), m.who === "ai" && !m.pending && body ? /* @__PURE__ */ React.createElement(MiraRender, { text: body }) : /* @__PURE__ */ React.createElement("span", { style: { whiteSpace: "pre-wrap" } }, body || (m.pending ? "\u2026" : "")), m.facets && m.facets.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-nb-facetline" }, m.facets.map((fc, j) => /* @__PURE__ */ React.createElement("span", { key: j, className: cls("vg-facet-tag", fc.error ? "bad" : "ok") }, fc.domain))), fmt2 && typeof fmt2 === "object" && fmt2.source && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, "source: ", fmt2.source), m.offline && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4 } }, "offline"), m.who === "ai" && m.corr && /* @__PURE__ */ React.createElement(ExplainToggle, { corr: m.corr }));
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
    const [open, setOpen] = useState7(false);
    const [rec, setRec] = useState7(void 0);
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
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", style: { fontSize: 12 }, onClick: toggle }, open ? "hide sources" : "sources"), open && /* @__PURE__ */ React.createElement("div", { className: "vg-msg-explain" }, rec === void 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "loading\u2026"), rec === null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no trace available"), claims.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i }, "\xB7 ", c.statement, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", c.source_type, ":", c.source_id, ")")))));
  }

  // src/use_stream_turn.js
  var { useState: useState8, useRef: useRef2, useEffect: useEffect8, useCallback: useCallback2 } = React;
  function collectTurn(prompt, thread, { onToken, setAbort } = {}) {
    return new Promise((resolve) => {
      let text = "";
      const abort = streamTurn(prompt, thread, (evt) => {
        if (evt.kind === "error") {
          if (setAbort) setAbort(null);
          resolve({ text, data: text ? parseMira(text) : null, error: evt.message || evt.text || "Mira error" });
          return;
        }
        if ((evt.kind === "token" || evt.kind === "delta" || evt.kind === "message") && evt.text) {
          text += evt.text;
          if (onToken) onToken(text);
          return;
        }
        if (evt.kind === "done") {
          if (setAbort) setAbort(null);
          if (evt.text && !text) text = evt.text;
          resolve({ text, data: text ? parseMira(text) : null, corr: evt.correlation_id || null });
        }
      });
      if (setAbort) setAbort(abort);
    });
  }
  function useStreamTurn(deps = []) {
    const [state, setState] = useState8(null);
    const abortRef = useRef2(null);
    const setAbort = useCallback2((fn) => {
      abortRef.current = fn;
    }, []);
    useEffect8(() => () => {
      if (abortRef.current) abortRef.current();
    }, []);
    useEffect8(() => {
      setState(null);
    }, deps);
    const run = useCallback2((prompt, thread) => {
      setState({ loading: true, text: "" });
      collectTurn(prompt, thread, {
        onToken: (text) => setState({ loading: true, text }),
        setAbort
      }).then(({ text, data, error }) => {
        setState(error ? { error, text } : { text, data });
      });
    }, [setAbort]);
    const abort = useCallback2(() => {
      if (abortRef.current) abortRef.current();
    }, []);
    const running = !!state && state.loading;
    return { state, run, running, abort, reset: () => setState(null) };
  }

  // src/portfolio_view.jsx
  var { useState: useState9, useRef: useRef3 } = React;
  var pct = (n, d = 1) => n == null ? "\u2014" : `${Number(n).toFixed(d)}%`;
  var ccyMoney = (n, ccy) => n == null ? "\u2014" : new Intl.NumberFormat(
    ccy === "INR" ? "en-IN" : "en-US",
    { style: "currency", currency: ccy || "USD", maximumFractionDigits: 0 }
  ).format(n);
  function WeightBar({ label, value, max, tone, right }) {
    const w = max > 0 ? Math.min(100, Math.abs(value) / max * 100) : 0;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pf-bar" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-bar-lbl" }, label), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-bar-track" }, /* @__PURE__ */ React.createElement("div", { className: cls("vg-pf-bar-fill", tone), style: { width: `${w}%` } })), /* @__PURE__ */ React.createElement("span", { className: "vg-pf-bar-val" }, right != null ? right : pct(value)));
  }
  function DiversificationCard({ d }) {
    if (!d) return null;
    const c = d.concentration || {};
    const sectors = Object.entries(d.by_sector || {}).sort((a, b) => b[1] - a[1]);
    const maxSec = Math.max(...sectors.map(([, v]) => v), 1);
    const bandTone = { diversified: "good", moderate: "warn", concentrated: "bad" }[c.band] || "plain";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card vg-pf-c-div" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Diversification"), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", bandTone) }, c.band, " \xB7 HHI ", c.hhi)), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Top 5 holdings", value: pct(c.top5_weight), note: "of the book" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Largest position", value: pct(c.top_name?.weight), note: c.top_name?.symbol }), /* @__PURE__ */ React.createElement(StatTile, { label: "Largest sector", value: pct(c.top_sector?.weight), note: c.top_sector?.sector })), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-bars" }, sectors.map(([s, v], i) => /* @__PURE__ */ React.createElement(WeightBar, { key: s, label: s, value: v, max: maxSec, tone: i === 0 ? "accent" : "accent-dim" }))), (c.single_name_flags || []).length > 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, "Concentrated single names (>7%): ", c.single_name_flags.map((f) => `${f.symbol} ${pct(f.weight)}`).join(" \xB7 ")));
  }
  function IncomeCard({ inc, ccy }) {
    if (!inc) return null;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Income")), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Projected annual", value: ccyMoney(inc.annual_income, ccy), note: "from dividends" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Portfolio yield", value: pct(inc.portfolio_yield, 2) }), /* @__PURE__ */ React.createElement(StatTile, { label: "Yield on cost", value: pct(inc.yield_on_cost, 2) })), (inc.contributors || []).length > 0 && /* @__PURE__ */ React.createElement("table", { className: "vg-pf-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "symbol"), /* @__PURE__ */ React.createElement("th", null, "yield"), /* @__PURE__ */ React.createElement("th", null, "annual"))), /* @__PURE__ */ React.createElement("tbody", null, inc.contributors.slice(0, 8).map((r) => /* @__PURE__ */ React.createElement("tr", { key: r.symbol }, /* @__PURE__ */ React.createElement("td", null, r.symbol), /* @__PURE__ */ React.createElement("td", null, pct(r.yield, 2)), /* @__PURE__ */ React.createElement("td", null, ccyMoney(r.annual_income, ccy)))))));
  }
  function shortSym(sym) {
    const s = String(sym || "");
    const m = s.match(/^(\S+)\s+\d{4}-\d{2}-\d{2}\s+(\d+(?:\.\d+)?[CP])$/);
    return m ? `${m[1]} ${m[2]}` : s;
  }
  function WinnersLosersCard({ wl, ccy }) {
    if (!wl) return null;
    const winners = wl.winners_pct || [];
    const losers = wl.losers_pct || [];
    if (!winners.length && !losers.length) return null;
    const Item = ({ r }) => /* @__PURE__ */ React.createElement("div", { className: "vg-pf-wl-item" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-wl-sym", title: r.symbol }, shortSym(r.symbol)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-pf-wl-pct", dirCls(r.gain_pct)) }, r.gain_pct == null ? "\u2014" : signPct(r.gain_pct)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-pf-wl-usd", dirCls(r.unrealized)) }, ccyMoney(r.unrealized, r.currency || ccy)));
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card vg-pf-c-wl" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Winners & losers"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "by gain %")), winners.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-wl-h up" }, "Top winners"), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-wl-list" }, winners.map((r) => /* @__PURE__ */ React.createElement(Item, { key: r.symbol, r })))), losers.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-wl-h down" }, "Worst losers"), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-wl-list" }, losers.map((r) => /* @__PURE__ */ React.createElement(Item, { key: r.symbol, r })))));
  }
  function RiskCard({ rk }) {
    if (!rk) return null;
    if (!rk.available) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Risk"), /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "no data")), /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, rk.note || "No stored daily bars for these holdings \u2014 risk (Sharpe / vol / drawdown) needs a price series. Scope to a US-equity account, or seed bars, to compute it."));
    }
    const thin = (rk.coverage_pct ?? 0) < 60;
    const sharpeTone = thin ? "plain" : rk.sharpe == null ? "plain" : rk.sharpe >= 1 ? "good" : rk.sharpe >= 0.5 ? "warn" : "bad";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Risk"), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", sharpeTone) }, "Sharpe ", rk.sharpe == null ? "\u2014" : rk.sharpe)), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Annualized vol", value: pct(rk.vol_annual_pct) }), /* @__PURE__ */ React.createElement(StatTile, { label: "Sortino", value: rk.sortino == null ? "\u2014" : rk.sortino }), /* @__PURE__ */ React.createElement(StatTile, { label: "Max drawdown", value: pct(rk.max_drawdown_pct), deltaDir: dirCls(rk.max_drawdown_pct) })), thin ? /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note warn" }, "\u26A0 Only ", pct(rk.coverage_pct), " of the book has price bars \u2014 these figures cover a slice, not the whole portfolio. Scope to a US-equity account for a fuller read.") : /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, rk.days, "d window \xB7 ", pct(rk.coverage_pct), " of book has bars"));
  }
  function UploadCsv({ kind, acctId, broker, onDone }) {
    const ref = useRef3(null);
    const [state, setState] = useState9(null);
    const isPos = kind === "positions";
    const label = isPos ? "holdings" : "transactions";
    const pick = () => ref.current && ref.current.click();
    const onFile = (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      setState({ busy: true });
      const call = isPos ? importPositions : importTransactions;
      call(f, acctId, broker || "fidelity").then((r) => {
        if (!r || r.available === false) {
          setState({ error: r && r.note || "import failed" });
          return;
        }
        setState({ result: r });
        setTimeout(() => onDone && onDone(), 2500);
      }).catch((err) => setState({ error: String(err && err.message || err) })).finally(() => {
        if (ref.current) ref.current.value = "";
      });
    };
    const summary = (r) => isPos ? `imported ${r.imported} holding${r.imported === 1 ? "" : "s"}` : `imported ${r.imported} (${r.buys} buy / ${r.sells} sell)`;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { ref, type: "file", accept: ".csv", style: { display: "none" }, onChange: onFile }), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        onClick: pick,
        disabled: state?.busy,
        title: isPos ? "Upload a POSITIONS/holdings CSV (Fidelity / Schwab) \u2192 what this account holds now (drives the analysis)" : "Upload a TRANSACTION-history CSV \u2192 buys/sells + realized gains (tax)"
      },
      state?.busy ? "importing\u2026" : `\u2B06 ${label}`
    ), state?.result && /* @__PURE__ */ React.createElement("span", { className: "vg-note good", title: (state.result.warnings || []).join(" \xB7 ") }, " ", "\u2713 ", summary(state.result), (state.result.warnings || []).length ? ` \xB7 ${state.result.warnings.length} skipped` : "", /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", style: { marginLeft: 4 }, onClick: () => setState(null) }, "\xD7")), state?.error && /* @__PURE__ */ React.createElement("span", { className: "vg-note bad" }, " \u2715 ", state.error, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", style: { marginLeft: 4 }, onClick: () => setState(null) }, "\xD7")));
  }
  function AddAccount({ onAdded }) {
    const [open, setOpen] = useState9(false);
    const [f, setF] = useState9({ id: "", name: "", broker: "fidelity", currency: "USD", taxable: true });
    const [err, setErr] = useState9(null);
    const [busy, setBusy] = useState9(false);
    const submit = () => {
      if (!f.id.trim() || !f.name.trim()) {
        setErr("id and name are required");
        return;
      }
      setBusy(true);
      setErr(null);
      createAccount(f).then((r) => {
        setBusy(false);
        if (r && r.error) {
          setErr(r.error);
          return;
        }
        setOpen(false);
        setF({ id: "", name: "", broker: "fidelity", currency: "USD", taxable: true });
        onAdded && onAdded();
      }).catch((e) => {
        setBusy(false);
        setErr(String(e && e.message || e));
      });
    };
    if (!open) return /* @__PURE__ */ React.createElement("button", { className: "vg-btn sm", onClick: () => setOpen(true) }, "+ Add broker / account");
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pf-addacct" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-addgrid" }, /* @__PURE__ */ React.createElement("label", null, "ID ", /* @__PURE__ */ React.createElement("input", { value: f.id, placeholder: "fid-taxable", onChange: (e) => setF({ ...f, id: e.target.value }) })), /* @__PURE__ */ React.createElement("label", null, "Name ", /* @__PURE__ */ React.createElement("input", { value: f.name, placeholder: "Fidelity Brokerage", onChange: (e) => setF({ ...f, name: e.target.value }) })), /* @__PURE__ */ React.createElement("label", null, "Broker", /* @__PURE__ */ React.createElement("select", { value: f.broker, onChange: (e) => setF({ ...f, broker: e.target.value }) }, /* @__PURE__ */ React.createElement("option", { value: "fidelity" }, "Fidelity (CSV)"), /* @__PURE__ */ React.createElement("option", { value: "schwab-api" }, "Schwab"), /* @__PURE__ */ React.createElement("option", { value: "robinhood" }, "Robinhood"), /* @__PURE__ */ React.createElement("option", { value: "zerodha" }, "Zerodha (INR)"), /* @__PURE__ */ React.createElement("option", { value: "alpaca" }, "Alpaca"), /* @__PURE__ */ React.createElement("option", { value: "" }, "Manual / other"))), /* @__PURE__ */ React.createElement("label", null, "Currency", /* @__PURE__ */ React.createElement("select", { value: f.currency, onChange: (e) => setF({ ...f, currency: e.target.value }) }, /* @__PURE__ */ React.createElement("option", null, "USD"), /* @__PURE__ */ React.createElement("option", null, "INR"))), /* @__PURE__ */ React.createElement("label", { className: "vg-pf-chk" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "checkbox",
        checked: f.taxable,
        onChange: (e) => setF({ ...f, taxable: e.target.checked })
      }
    ), " taxable")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn sm on", onClick: submit, disabled: busy }, busy ? "Adding\u2026" : "Add"), /* @__PURE__ */ React.createElement("button", { className: "vg-btn sm", onClick: () => {
      setOpen(false);
      setErr(null);
    } }, "cancel")), err && /* @__PURE__ */ React.createElement("p", { className: "vg-note bad" }, err));
  }
  function AccountManagerCard({
    ba,
    accounts: accounts2,
    accountId,
    setAccountId,
    refreshing,
    onRefreshAccount,
    onChanged
  }) {
    const conc = ba && ba.concentration || {};
    const flags = Object.entries(conc).filter(([, c]) => c.top_pct >= 60 && c.n_accounts > 1);
    const list = accounts2 || [];
    const remove = (a) => {
      if (!window.confirm(`Remove account "${a.short}" and its lots? This can't be undone.`)) return;
      deleteAccount(a.id).then(() => onChanged && onChanged());
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pf-managepanel" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-acctlist" }, list.map((a) => {
      const csvOnly = a.refreshable === false;
      const pending = !!(refreshing && refreshing[a.id]);
      return /* @__PURE__ */ React.createElement("div", { key: a.id, className: cls("vg-pf-acctrow", accountId === a.id && "on") }, /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-pf-acctpick",
          onClick: () => setAccountId && setAccountId(a.id),
          title: `Scope to ${a.short}`
        },
        /* @__PURE__ */ React.createElement("span", { className: "vg-pf-acctname" }, /* @__PURE__ */ React.createElement("b", null, a.short), a.broker && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { marginLeft: 6 } }, a.broker), a.has_holdings === false && /* @__PURE__ */ React.createElement(
          "span",
          {
            className: "vg-badge warn",
            style: { marginLeft: 6 },
            title: "No holdings imported \u2014 this account is excluded from the analysis. Upload a positions/holdings CSV."
          },
          "no holdings"
        )),
        /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, a.type, a.lastSynced !== void 0 ? ` \xB7 synced ${syncedAgo(a.lastSynced)}` : "", a.has_transactions ? " \xB7 has transactions" : "")
      ), /* @__PURE__ */ React.createElement("span", { className: "vg-pf-acctval" }, money(a.value, a.currency || "USD")), /* @__PURE__ */ React.createElement("span", { className: "vg-pf-acctactions" }, !csvOnly && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-linkbtn",
          disabled: pending,
          onClick: () => onRefreshAccount && onRefreshAccount(a.id),
          title: `Refresh ${a.short} (re-pull holdings + transactions)`
        },
        pending ? "\u2026" : "\u27F3 sync"
      ), /* @__PURE__ */ React.createElement(UploadCsv, { kind: "positions", acctId: a.id, broker: a.broker, onDone: onChanged }), /* @__PURE__ */ React.createElement(UploadCsv, { kind: "transactions", acctId: a.id, broker: a.broker, onDone: onChanged }), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn bad", onClick: () => remove(a), title: "Remove account" }, "\u2715")));
    })), flags.map(([c, cc]) => /* @__PURE__ */ React.createElement("p", { key: c, className: "vg-note vg-pf-note" }, cc.top_account, " holds ", pct(cc.top_pct), " of the ", c, " book \u2014 single-account concentration.")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(AddAccount, { onAdded: onChanged })));
  }
  function AccountBar({
    ba,
    accounts: accounts2,
    accountId,
    setAccountId,
    refreshing,
    onRefreshAccount,
    onRefreshAll,
    refreshNote,
    onChanged
  }) {
    const [manage, setManage] = useState9(false);
    const list = accounts2 || [];
    const total = list.reduce((m, a) => {
      const c = a.currency || "USD";
      m[c] = (m[c] || 0) + (a.value || 0);
      return m;
    }, {});
    const totalLabel = Object.entries(total).map(([c, v]) => money(v, c)).join(" \xB7 ");
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-acctbar" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-chips" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-pf-chip-acct", accountId === "all" && "on"),
        onClick: () => setAccountId && setAccountId("all"),
        title: "All accounts"
      },
      /* @__PURE__ */ React.createElement("b", null, "All"),
      " ",
      /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, totalLabel)
    ), list.map((a) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: a.id,
        className: cls("vg-pf-chip-acct", accountId === a.id && "on"),
        onClick: () => setAccountId && setAccountId(a.id),
        title: `Scope to ${a.name || a.short}${a.lastSynced !== void 0 ? ` \xB7 synced ${syncedAgo(a.lastSynced)}` : ""}`
      },
      /* @__PURE__ */ React.createElement("b", null, a.short),
      " ",
      /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, money(a.value, a.currency || "USD"))
    )), onRefreshAll && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-btn sm", refreshing && refreshing.all && "on"),
        disabled: !!(refreshing && refreshing.all),
        onClick: onRefreshAll,
        title: "Refresh every API-linked account"
      },
      "\u27F3 ",
      refreshing && refreshing.all ? "Refreshing\u2026" : "Refresh all"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-btn sm vg-pf-manage", manage && "on"),
        onClick: () => setManage((v) => !v),
        title: "Add / import / sync / remove accounts"
      },
      "\u2699 ",
      manage ? "Done" : "Manage"
    )), refreshNote && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, refreshNote.text), manage && /* @__PURE__ */ React.createElement(
      AccountManagerCard,
      {
        ba,
        accounts: accounts2,
        accountId,
        setAccountId,
        refreshing,
        onRefreshAccount,
        onChanged
      }
    ));
  }
  function RebalanceCard({ rb, targets }) {
    if (!rb) return null;
    const maxDrift = Math.max(...(rb.rows || []).map((r) => Math.abs(r.drift_pct)), 1);
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Rebalance"), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", rb.in_band ? "good" : "warn") }, rb.in_band ? "in band" : `drift ${pct(rb.max_drift_pct)}`)), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-bars" }, (rb.rows || []).map((r) => /* @__PURE__ */ React.createElement(
      WeightBar,
      {
        key: r.asset_class,
        label: `${r.asset_class} (${pct(r.current_pct)} \u2192 ${pct(r.target_pct)})`,
        value: r.drift_pct,
        max: maxDrift,
        tone: r.drift_pct > 0 ? "down" : "up",
        right: r.trade_usd ? `${r.action} ${usd(Math.abs(r.trade_usd))}` : "hold"
      }
    ))), /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, "Target model: ", Object.entries(targets || {}).map(([k, v]) => `${k} ${v}%`).join(" \xB7 ")));
  }
  function CharacterCard({ ch }) {
    if (!ch) return null;
    const betaNote = ch.beta == null ? "no beta coverage" : ch.beta > 1 ? "more volatile than the market" : ch.beta < 1 ? "less volatile than the market" : "in line with the market";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Portfolio character")), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Weighted beta", value: ch.beta == null ? "\u2014" : ch.beta, note: betaNote }), /* @__PURE__ */ React.createElement(StatTile, { label: "Blended P/E", value: ch.pe == null ? "\u2014" : ch.pe }), /* @__PURE__ */ React.createElement(StatTile, { label: "Beta coverage", value: pct(ch.covered_pct), note: "of value has a beta" })));
  }
  function PerformanceCard({ account, accounts: accounts2 }) {
    const q = useLive(() => portfolioPerformance(account), null, [account]);
    const d = q.data;
    const scoped = (accounts2 || []).filter((a) => account === "all" || a.id === account);
    const byCcy = scoped.reduce((m, a) => {
      const c = a.currency || "USD";
      m[c] = (m[c] || 0) + (a.value || 0);
      return m;
    }, {});
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Performance"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "point-in-time")), Object.keys(byCcy).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, Object.entries(byCcy).map(([c, v]) => /* @__PURE__ */ React.createElement(StatTile, { key: c, label: `Book value \xB7 ${c}`, value: money(v, c) }))), q.loading && /* @__PURE__ */ React.createElement(LoadBar, null), d && d.available && d.twr != null && /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Time-weighted return", value: signPct(d.twr), deltaDir: dirCls(d.twr) }), /* @__PURE__ */ React.createElement(StatTile, { label: "vs benchmark", value: d.benchmark != null ? signPct(d.benchmark) : "\u2014" })), d && !d.available && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, "Time-weighted return + benchmark accrue once nightly value snapshots begin \u2014 no history yet."));
  }
  function AnalyzePane({ account }) {
    const { state, run: runTurn } = useStreamTurn([account]);
    const run = () => {
      const ref = `PORTFOLIO_SNAPSHOT_REF account=${account}`;
      const prompt = `Analyze my portfolio and give me recommended actions. Read the DNA \u2014 currencies are separate books, never combine them \u2014 and end in concrete, sized actions (trim / harvest / rebalance / diversify).
${ref}`;
      runTurn(prompt, `portfolio-${account}`);
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card vg-pf-analyze" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Mira \xB7 portfolio actions"), /* @__PURE__ */ React.createElement("button", { className: "vg-btn sm vg-btn-primary", onClick: run, disabled: state?.loading }, state?.loading ? "Analyzing\u2026" : state ? "Re-analyze" : "Analyze my portfolio")), !state && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, "Mira reads your portfolio DNA and recommends actions \u2014 decision-support, not orders."), state?.loading && !state.text && /* @__PURE__ */ React.createElement(LoadBar, null), state?.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note bad" }, state.error), state?.text && /* @__PURE__ */ React.createElement(MiraRender, { text: state.text }));
  }
  function PortfolioView({
    accountId,
    setAccountId,
    scopeAccounts,
    refreshing,
    onRefreshAccount,
    onRefreshAll,
    refreshNote,
    lead,
    onAccountsChanged
  }) {
    const account = accountId || "all";
    const changeTimer = useRef3(null);
    const changed = React.useCallback(() => {
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = setTimeout(() => onAccountsChanged && onAccountsChanged(), 900);
    }, [onAccountsChanged]);
    const [ccy, setCcy] = useState9("");
    const q = useLive(() => portfolioAnalyze(account, ccy || "USD"), null, [account, ccy]);
    const d = q.data;
    const currencies = (() => {
      const cs = d?.currencies || [];
      return cs.includes("USD") ? ["USD", ...cs.filter((c) => c !== "USD")] : cs;
    })();
    const activeCcy = d?.currency || ccy || (currencies[0] || "USD");
    const scopeLabel = account === "all" ? "all accounts" : (scopeAccounts || []).find((a) => a.id === account)?.short || account;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pf" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-topbar" }, /* @__PURE__ */ React.createElement("h2", { className: "vg-pf-h2" }, "Portfolio"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Roll-up analysis \xB7 scope: ", scopeLabel, account !== "all" && /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { marginLeft: 6 },
        onClick: () => setAccountId && setAccountId("all")
      },
      "all \u2192"
    )), currencies.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "vg-pf-ccy", role: "group", "aria-label": "currency" }, currencies.map((c) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: c,
        className: cls("vg-chip", c === activeCcy && "on"),
        onClick: () => setCcy(c)
      },
      c
    )))), /* @__PURE__ */ React.createElement(
      AccountBar,
      {
        ba: d?.by_account,
        accounts: scopeAccounts,
        accountId: account,
        setAccountId,
        refreshing,
        onRefreshAccount,
        onRefreshAll,
        refreshNote,
        onChanged: changed
      }
    ), lead, (() => {
      const missing = (scopeAccounts || []).filter((a) => a.has_holdings === false && (account === "all" || a.id === account));
      if (!missing.length) return null;
      return /* @__PURE__ */ React.createElement("p", { className: "vg-pf-excluded vg-note" }, "\u26A0 ", missing.map((a) => a.short).join(", "), " ", missing.length === 1 ? "has" : "have", " no holdings imported \u2014 excluded from the analysis below. Upload a positions/holdings CSV (\u2699 Manage) or sync to include ", missing.length === 1 ? "it" : "them", ".");
    })(), q.loading && /* @__PURE__ */ React.createElement(LoadBar, null), d && /* @__PURE__ */ React.createElement("div", { className: "vg-pf-grid" }, /* @__PURE__ */ React.createElement(AnalyzePane, { account }), /* @__PURE__ */ React.createElement(DiversificationCard, { d: d.diversification }), /* @__PURE__ */ React.createElement(WinnersLosersCard, { wl: d.winners_losers, ccy: activeCcy }), /* @__PURE__ */ React.createElement(RiskCard, { rk: d.risk }), /* @__PURE__ */ React.createElement(IncomeCard, { inc: d.income, ccy: activeCcy }), /* @__PURE__ */ React.createElement(RebalanceCard, { rb: d.rebalance, targets: d.targets }), /* @__PURE__ */ React.createElement(CharacterCard, { ch: d.character }), /* @__PURE__ */ React.createElement(PerformanceCard, { account, accounts: scopeAccounts })), !q.loading && !d && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: 14 } }, "No portfolio data."));
  }

  // src/options.jsx
  var { useState: useState10, useEffect: useEffect9 } = React;
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
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { onClick: onToggle, style: { cursor: "pointer", opacity: dimmed ? 0.55 : 1 }, title: "Show legs" }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { style: { marginRight: 6, color: "var(--color-grey)" } }, expanded ? "\u25BE" : "\u25B8"), /* @__PURE__ */ React.createElement("b", null, stratLabel(s)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", kindChipCls(s.kind)), style: { marginLeft: 6 } }, kindChip(s.kind))), /* @__PURE__ */ React.createElement("td", null, s.underlying || "\u2014"), /* @__PURE__ */ React.createElement("td", null, s.direction === "credit" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "credit"), s.direction === "debit" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "debit"), s.direction !== "credit" && s.direction !== "debit" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: cls("num", s.cash == null ? "" : s.cash >= 0 ? "up" : "down") }, s.cash != null ? signUsd(s.cash) : "\u2014"), /* @__PURE__ */ React.createElement("td", null, s.state === "filled" && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "filled"), s.state === "cancelled" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "cancelled"), s.state === "rejected" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "rejected"), s.state && !["filled", "cancelled", "rejected"].includes(s.state) && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, s.state), !s.state && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", null, w.day, w.time && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, w.time))), expanded && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { background: "var(--color-light)", padding: "6px 12px" } }, legs.length ? legs.map((leg, i) => /* @__PURE__ */ React.createElement(StrategyLeg, { key: i, leg, underlying: s.underlying })) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no leg detail"))));
  }
  function StrategiesSection({ accountId }) {
    const [tab, setTab] = useState10("open");
    const [shown, setShown] = useState10(STRAT_PAGE);
    const [open, setOpen] = useState10({});
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
    useEffect9(() => {
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

  // src/paper.jsx
  var { useState: useState11 } = React;
  var usd2 = (v) => v == null ? "\u2014" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
  var pct2 = (v) => v == null ? "\u2014" : `${Math.round(100 * v)}%`;
  var px = (v) => v == null ? "\u2014" : Number(v).toFixed(2);
  var FRESH_TONE = { strong: "good", fresh: "plain", tested: "warn", weak: "bad" };
  var _gradN = 0;
  function EquityCurve({ curve }) {
    if (!curve || curve.length < 2) return null;
    const W = 720, H = 150, padX = 8, padT = 14, padB = 10;
    const xs = curve.map((p) => p.cum), peaks = curve.map((p) => p.peak);
    const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs, 0), range = hi - lo || 1;
    const x = (i) => padX + i / (curve.length - 1) * (W - 2 * padX);
    const y = (v) => H - padB - (v - lo) / range * (H - padT - padB);
    const line2 = (a) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = xs[xs.length - 1];
    const up = last >= 0;
    const col = up ? "var(--vg-up)" : "var(--vg-down)";
    const gid = `eq-grad-${_gradN = (_gradN + 1) % 1e3}`;
    const area = `${line2(xs)} L${x(curve.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;
    const ex = x(curve.length - 1), ey = y(last);
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        viewBox: `0 0 ${W} ${H}`,
        width: "100%",
        height: H,
        preserveAspectRatio: "xMidYMid meet",
        style: { display: "block" },
        role: "img",
        "aria-label": "Cumulative P&L equity curve"
      },
      /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("linearGradient", { id: gid, x1: "0", y1: "0", x2: "0", y2: "1" }, /* @__PURE__ */ React.createElement("stop", { offset: "0%", stopColor: col, stopOpacity: "0.22" }), /* @__PURE__ */ React.createElement("stop", { offset: "100%", stopColor: col, stopOpacity: "0" }))),
      /* @__PURE__ */ React.createElement("line", { x1: padX, y1: y(0), x2: W - padX, y2: y(0), stroke: "var(--vg-rule)", strokeOpacity: "0.6", strokeDasharray: "2 3" }),
      /* @__PURE__ */ React.createElement("path", { d: line2(peaks), fill: "none", stroke: "var(--vg-faint)", strokeOpacity: "0.5", strokeWidth: "1", strokeDasharray: "3 3" }),
      /* @__PURE__ */ React.createElement("path", { d: area, fill: `url(#${gid})` }),
      /* @__PURE__ */ React.createElement("path", { d: line2(xs), fill: "none", stroke: col, strokeWidth: "2", strokeLinejoin: "round" }),
      /* @__PURE__ */ React.createElement("circle", { cx: ex, cy: ey, r: "3.5", fill: col }),
      /* @__PURE__ */ React.createElement(
        "text",
        {
          x: ex - 6,
          y: ey - 8,
          textAnchor: "end",
          fontSize: "12",
          fontWeight: "600",
          fill: col,
          style: { fontVariantNumeric: "tabular-nums" }
        },
        usd2(last)
      )
    );
  }
  function TrackRecordTable({ rows, label, detail, reason }) {
    const [showAll, setShowAll] = React.useState(false);
    const real = rows.filter((r) => (r.pnl || 0) !== 0);
    const flat = rows.filter((r) => (r.pnl || 0) === 0);
    const shown = showAll ? real : real.slice(0, 15);
    const Row = (r) => {
      const pnl = r.pnl || 0;
      const tone = pnl > 0 ? "good" : pnl < 0 ? "bad" : "flat";
      return /* @__PURE__ */ React.createElement("div", { key: r.id, className: "vg-tr-row" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-tr-dot", tone), "aria-hidden": "true" }), /* @__PURE__ */ React.createElement("span", { className: cls("vg-tr-pnl", tone) }, pnl === 0 ? "\u2014" : usd2(pnl)), /* @__PURE__ */ React.createElement("span", { className: "vg-tr-label" }, label(r)), /* @__PURE__ */ React.createElement("span", { className: "vg-tr-detail" }, detail(r)), r.live && /* @__PURE__ */ React.createElement(LiveTwin, { live: r.live }), /* @__PURE__ */ React.createElement("span", { className: cls("vg-tr-reason", reason(r)) }, reason(r)));
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-tr-table" }, shown.map(Row), real.length > 15 && !showAll && /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn vg-tr-more", onClick: () => setShowAll(true) }, "show ", real.length - 15, " more"), flat.filter((r) => r.live).map(Row), flat.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-tr-flat" }, flat.length, " no-fill / voided (", flat.filter((r) => reason(r) === "never_filled").length, " never filled \xB7", " ", flat.filter((r) => reason(r) === "voided").length, " voided) \u2014 $0, excluded from win-rate"));
  }
  function PaperView({ refreshNonce }) {
    const [nonce, setNonce] = useState11(0);
    const [busy, setBusy] = useState11("");
    const [sym, setSym] = useState11("SPX");
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-playbook" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Paper trading ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 13, fontWeight: 400 } }, "\xB7 no money")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 6, marginBottom: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement(SymbolSwitcher, { value: sym, onChange: setSym })), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, d ? `${open.length} open \xB7 ${closed.length} closed` : "loading\u2026", d && d.session ? ` \xB7 from the ${d.session} ${sym} playbook` : ""), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm accent", disabled: busy === "settle", onClick: doSettle }, busy === "settle" ? "Checking\u2026" : "Check fills (settle)"))), stats.n > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-levels" }, /* @__PURE__ */ React.createElement(Tile, { label: "Win rate", value: pct2(stats.win_rate), tone: stats.win_rate >= 0.5 ? "good" : "bad", termKey: "win_rate" }), /* @__PURE__ */ React.createElement(Tile, { label: "Net P&L", value: usd2(stats.total_pnl), tone: stats.total_pnl >= 0 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(Tile, { label: "Profit factor", value: stats.profit_factor ?? "\u2014", tone: stats.profit_factor >= 1.3 ? "good" : "warn", termKey: "profit_factor" }), /* @__PURE__ */ React.createElement(Tile, { label: "Closed", value: stats.n }))), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 13, margin: "2px 0 4px" } }, "Signals from today's playbook, priced on SPY. Wait for the", " ", /* @__PURE__ */ React.createElement(Term, { k: "reclaim" }, "reclaim trigger"), " \u2014 never enter on the touch \u2014 then log the trade and it auto-closes when it hits the ", /* @__PURE__ */ React.createElement(Term, { k: "fade" }, "target or stop"), ". No real orders are ever placed."), d && d.ticket_note && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No tradeable tickets"), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 13, marginTop: 6 } }, d.ticket_note)), tickets.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today's trade tickets (SPY)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8, marginTop: 8 } }, tickets.map((t, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-setup" }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", t.side === "long" ? "good" : "bad"),
        style: { minWidth: 44, textAlign: "center" }
      },
      t.side === "long" ? "BUY" : "SELL"
    ), " ", /* @__PURE__ */ React.createElement("b", null, t.signal), t.setup === "break" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { marginLeft: 6, fontSize: 12 } }, "BREAK \u2014 experts"), t.counter_trend && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad", style: { marginLeft: 6, fontSize: 12 } }, "\u26A0 counter-trend"), t.freshness && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", FRESH_TONE[t.freshness] || "plain"),
        style: { marginLeft: 6, fontSize: 12 }
      },
      t.freshness
    )), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy === "open", onClick: () => doOpen(t) }, "Paper trade")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 13, marginTop: 4 } }, "Entry ", /* @__PURE__ */ React.createElement("b", null, px(t.spy_entry)), " \xB7 target ", /* @__PURE__ */ React.createElement("b", null, px(t.spy_target)), " \xB7 stop ", /* @__PURE__ */ React.createElement("b", null, px(t.spy_stop)), t.reward_risk != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement(Term, { k: "reward_risk" }, "R:R"), " ", t.reward_risk), " \xB7 ", "~", px(t.ref_strike), " 0DTE", t.otm_strike != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ~", px(t.otm_strike), " OTM"), t.spx_level ? ` \xB7 ${t.underlying || "SPX"} ${Math.round(t.spx_level)}` : ""), t.entry_note && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginTop: 3 } }, /* @__PURE__ */ React.createElement("b", null, /* @__PURE__ */ React.createElement(Term, { k: "reclaim" }, "Trigger"), ":"), " ", t.entry_note), (t.freshness_note || t.trend_note || t.otm_note) && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginTop: 2, opacity: 0.85 } }, [t.trend_note, t.freshness_note, t.otm_note].filter(Boolean).join(" \xB7 ")))))), open.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Open paper trades"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, open.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.id, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", r.side === "long" ? "good" : "bad"), style: { minWidth: 44, textAlign: "center" } }, r.side === "long" ? "BUY" : "SELL"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, r.signal), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, "entry ", px(r.spy_entry), " \xB7 tgt ", px(r.spy_target), " \xB7 stop ", px(r.spy_stop)), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-linkbtn",
        style: { marginLeft: 8 },
        disabled: busy === `close${r.id}`,
        onClick: () => doClose(r)
      },
      busy === `close${r.id}` ? "\u2026" : "close"
    ))))), closed.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tr" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Track record"), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, Object.entries(stats.by_exit || {}).map(([k, v]) => `${v} ${k}`).join(" \xB7 "))), /* @__PURE__ */ React.createElement("div", { className: "vg-tr-curve" }, /* @__PURE__ */ React.createElement(EquityCurve, { curve: d.equity_curve })), /* @__PURE__ */ React.createElement(
      TrackRecordTable,
      {
        rows: closed,
        label: (r) => r.signal,
        detail: (r) => `${px(r.spy_entry)} \u2192 ${px(r.spy_exit)}`,
        reason: (r) => r.exit_reason
      }
    )), /* @__PURE__ */ React.createElement(GlossaryCard, { terms: ["reclaim", "fade", "reward_risk", "win_rate", "profit_factor"] }), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats" }, /* @__PURE__ */ React.createElement("div", null, "SPY is a proxy for SPX; P&L is on SPY shares. A simulation for learning + strategy validation."), /* @__PURE__ */ React.createElement("div", null, "Places NO real orders and touches no broker or funds (ADR-010). Not financial advice.")));
  }
  function spreadLabel(r) {
    const kind = r.structure === "debit_call_spread" ? "CALL" : "PUT";
    return `${r.underlying} ${kind} ${px(r.long_strike)}/${px(r.short_strike)} \xD7${r.contracts}`;
  }
  function LiveTwin({ live }) {
    const closedWin = live.status === "closed" && live.realized != null;
    return /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", closedWin ? live.realized >= 0 ? "good" : "bad" : "warn"),
        style: { fontSize: 12 },
        title: `Real trade correlated to this scanner setup \xB7 opened ${live.opened_at} \xB7 exp ${live.expiration}`
      },
      "LIVE ",
      live.label,
      live.status === "closed" ? ` ${usd2(live.realized)}` : live.cost ? ` \xB7 $${Math.round(live.cost)} in` : ""
    );
  }
  function ScannerSpreadBook({ refreshNonce, alwaysShow }) {
    const q = useLive(() => getSpreadBook(), null, [refreshNonce]);
    const d = q.data;
    if (!d || d.available === false) return null;
    const open = d.open || [];
    const closed = d.closed || [];
    const stats = d.stats || {};
    if (!open.length && !closed.length) {
      if (!alwaysShow) return null;
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Paper trades \u2014 scanner spreads"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "8px 0 0", fontSize: 13 } }, "No paper spreads yet. When an A+ scanner setup fires it opens a debit spread here (on Alpaca paper when configured) \u2014 open positions + a closed track record with win-rate. Separate from the SPX reclaim book."));
    }
    const onAlpaca = [...open, ...closed].some((r) => r.broker === "alpaca-paper");
    const brokerLabel = (r) => {
      if (r.broker !== "alpaca-paper") return null;
      if (r.fill_status === "pending") return { text: "submitted", tone: "warn" };
      if (r.broker_status === "filled" || r.fill_status === "filled") return { text: "filled", tone: "good" };
      return { text: r.broker_status || "working", tone: "plain" };
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Scanner spreads"), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, "auto-logged from A+ setups \xB7 debit spreads \xB7 separate from the reclaim record", onAlpaca && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--vg-up)" } }, "Alpaca paper"), " (real fills)"))), d.by_strategy && Object.keys(d.by_strategy).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { fontSize: 12, marginBottom: 4 } }, "By strategy", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \u2014 which scanner armed the trade \xB7 money-at-risk closes only")), /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Strategy"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Open"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Closed"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Win rate"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "PF"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Net P&L"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Taken live"))), /* @__PURE__ */ React.createElement("tbody", null, Object.entries(d.by_strategy).map(([name, s]) => /* @__PURE__ */ React.createElement("tr", { key: name }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, name)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.open || 0), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.n || 0), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.n ? pct2(s.win_rate) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.profit_factor != null ? s.profit_factor.toFixed(2) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.n ? /* @__PURE__ */ React.createElement("b", { className: s.total_pnl >= 0 ? "vg-up" : "vg-down" }, usd2(s.total_pnl)) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.live_taken ? /* @__PURE__ */ React.createElement(React.Fragment, null, s.live_taken, s.live_realized ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement("b", { className: s.live_realized >= 0 ? "vg-up" : "vg-down" }, usd2(s.live_realized))) : null) : "\u2014")))))), stats.n > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-stats", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement(Tile, { label: "Net P&L", value: usd2(stats.total_pnl), tone: stats.total_pnl >= 0 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(Tile, { label: "Win rate", value: pct2(stats.win_rate), termKey: "win_rate" }), /* @__PURE__ */ React.createElement(Tile, { label: "Profit factor", value: stats.profit_factor != null ? stats.profit_factor.toFixed(2) : "\u2014", termKey: "profit_factor" }), /* @__PURE__ */ React.createElement(Tile, { label: "Closed", value: stats.n })), (d.live_manual || []).length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { fontSize: 12, marginBottom: 4 } }, "Taken live \u2014 manual tags", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, " \u2014 real trades from older scans, no paper twin; tagged by the operator")), d.live_manual.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(LiveTwin, { live: m }), /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { fontSize: 12 } }, m.strategy), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, "manual tag \xB7 exp ", m.expiration)))), open.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, margin: "12px 0 4px" } }, "Open (", open.length, ")"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder" }, open.map((r) => {
      const bs = brokerLabel(r);
      if (r.book === "scanner-shares") {
        return /* @__PURE__ */ React.createElement("div", { key: r.id, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { className: "vg-badge good", style: { minWidth: 44, textAlign: "center" } }, "SHARES"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, r.symbol, " \xD7", Math.round(r.shares), " @ ", px(r.spy_entry)), /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { fontSize: 12 } }, r.setup), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, "exit: close > 5-day MA or 5 sessions \xB7 sim"));
      }
      return /* @__PURE__ */ React.createElement("div", { key: r.id, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
        "span",
        {
          className: cls("vg-badge", r.side === "long" ? "good" : "bad"),
          style: { minWidth: 44, textAlign: "center" }
        },
        r.side === "long" ? "CALL" : "PUT"
      ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, spreadLabel(r)), bs && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", bs.tone), style: { fontSize: 12 } }, bs.text), r.live && /* @__PURE__ */ React.createElement(LiveTwin, { live: r.live }), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, "target ", px(r.short_strike), " \xB7 invalid ", px(r.underlying_invalid)));
    }))), closed.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, d.equity_curve && d.equity_curve.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "vg-tr-curve" }, /* @__PURE__ */ React.createElement(EquityCurve, { curve: d.equity_curve })), /* @__PURE__ */ React.createElement(
      TrackRecordTable,
      {
        rows: closed,
        label: (r) => spreadLabel(r),
        detail: (r) => r.exit_reason === "target" ? `\u2192 ${px(r.short_strike)}` : `\xD7 ${px(r.underlying_invalid)}`,
        reason: (r) => r.exit_reason
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats", style: { marginTop: 10 } }, onAlpaca ? /* @__PURE__ */ React.createElement("div", null, "Book of record: ", /* @__PURE__ */ React.createElement("b", null, "Alpaca paper"), " \u2014 real multi-leg fills, closed on the invalidation (stop-loss) or target. Paper account only, no real money.") : /* @__PURE__ */ React.createElement("div", null, "Debit spreads modeled from scanner setups (no live options chain \u2014 debit \u2248 \xBD width). A simulation; places no orders (ADR-010).")));
  }
  function Tile({ label, value, tone, termKey }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-tile" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12 } }, termKey ? /* @__PURE__ */ React.createElement(Term, { k: termKey }, label) : label), /* @__PURE__ */ React.createElement("div", { className: cls("vg-pb-tileval", tone) }, value));
  }

  // src/strategies_view.jsx
  var { useState: useState12, useCallback: useCallback3, useEffect: useEffect10 } = React;
  var pct3 = (n, d = 1) => n == null ? "\u2014" : `${(Number(n) * 100).toFixed(d)}%`;
  var STAGE_TONE = { paper: "plain", eligible: "good", live: "info", paused: "warn" };
  var STAGE_LABEL = { paper: "PAPER", eligible: "ELIGIBLE", live: "LIVE", paused: "PAUSED" };
  function GateRow({ gate }) {
    if (!gate) return null;
    const wr = gate.paper_win_rate, base = gate.baseline_win_rate;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-sl-gate" }, /* @__PURE__ */ React.createElement("div", { className: "vg-sl-gatebar" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "paper"), /* @__PURE__ */ React.createElement("b", { className: cls(gate.passes ? "vg-up" : "vg-down") }, pct3(wr)), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "vs baseline"), /* @__PURE__ */ React.createElement("b", null, pct3(base)), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\xB7 ", gate.paper_n, "/", gate.min_sample, " trades"), /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", gate.passes ? "good" : "plain"),
        style: { marginLeft: "auto" }
      },
      gate.passes ? "GATE PASSES" : "GATE NOT MET"
    )), /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-sl-gatewhy" }, gate.reason));
  }
  function PromoteForm({ sid, onDone }) {
    const [acct, setAcct] = useState12("ALPACA-PAPER");
    const [maxUsd, setMaxUsd] = useState12(5e3);
    const [maxPos, setMaxPos] = useState12(3);
    const [maxLoss, setMaxLoss] = useState12(1e3);
    const [busy, setBusy] = useState12(false);
    const [err, setErr] = useState12(null);
    const submit = () => {
      setBusy(true);
      setErr(null);
      promoteStrategy(sid, { account: acct, caps: {
        max_order_usd: Number(maxUsd),
        max_positions: Number(maxPos),
        max_daily_loss_usd: Number(maxLoss)
      } }).then((r) => {
        setBusy(false);
        if (r && r.available === false) {
          setErr(r.note || "promotion refused");
          return;
        }
        onDone();
      }).catch((e) => {
        setBusy(false);
        setErr(String(e && e.message || e));
      });
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-sl-promote" }, /* @__PURE__ */ React.createElement("div", { className: "vg-sl-caps" }, /* @__PURE__ */ React.createElement("label", null, "Account ", /* @__PURE__ */ React.createElement("input", { value: acct, onChange: (e) => setAcct(e.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Max $/order ", /* @__PURE__ */ React.createElement("input", { type: "number", value: maxUsd, onChange: (e) => setMaxUsd(e.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Max positions ", /* @__PURE__ */ React.createElement("input", { type: "number", value: maxPos, onChange: (e) => setMaxPos(e.target.value) })), /* @__PURE__ */ React.createElement("label", null, "Daily max-loss $ ", /* @__PURE__ */ React.createElement("input", { type: "number", value: maxLoss, onChange: (e) => setMaxLoss(e.target.value) }))), /* @__PURE__ */ React.createElement("button", { className: "vg-btn sm on", onClick: submit, disabled: busy }, busy ? "Promoting\u2026" : "Promote to live"), err && /* @__PURE__ */ React.createElement("p", { className: "vg-note bad" }, err), /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "Promotion is deliberate \u2014 it enables autonomous orders for this strategy within these caps. Orders still only reach the broker when live is ARMED (below)."));
  }
  function AuditTrail({ sid }) {
    const [open, setOpen] = useState12(false);
    const q = useLive(() => open ? getStrategyAudit(sid) : Promise.resolve(null), null, [sid, open]);
    const rows = q.data && q.data.audit || [];
    return /* @__PURE__ */ React.createElement("div", { className: "vg-sl-audit" }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setOpen((v) => !v) }, open ? "\u25BE" : "\u25B8", " audit trail", rows.length ? ` (${rows.length})` : ""), open && q.loading && /* @__PURE__ */ React.createElement(LoadBar, null), open && rows.length > 0 && /* @__PURE__ */ React.createElement("table", { className: "vg-sl-audittable" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "when"), /* @__PURE__ */ React.createElement("th", null, "mode"), /* @__PURE__ */ React.createElement("th", null, "order"), /* @__PURE__ */ React.createElement("th", null, "reason"))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((a) => /* @__PURE__ */ React.createElement("tr", { key: a.id }, /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, String(a.at || "").slice(5, 16).replace("T", " ")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls(
      "vg-badge",
      a.mode === "submitted" ? "info" : a.mode === "cap_breach" ? "bad" : a.mode === "refused" ? "warn" : "plain"
    ) }, a.mode)), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, a.order?.side, " ", a.order?.qty, " ", a.order?.symbol, a.order?.est_usd ? ` \xB7 ${usd(a.order.est_usd)}` : ""), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, a.reason || "\u2014"))))), open && !q.loading && rows.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "2px 0" } }, "No orders yet."));
  }
  function StrategyCard2({ s, armed, onChange }) {
    const stage = s.stage;
    const [busy, setBusy] = useState12(false);
    const act = (fn) => {
      setBusy(true);
      fn().then(() => {
        setBusy(false);
        onChange();
      }).catch(() => setBusy(false));
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-sl-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-sl-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "vg-sl-name" }, s.display_name || s.strategy_id), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", STAGE_TONE[stage]), style: { marginLeft: 8 } }, STAGE_LABEL[stage] || stage)), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, (s.universe || []).join(" \xB7 "))), /* @__PURE__ */ React.createElement(GateRow, { gate: s.gate }), stage === "live" && /* @__PURE__ */ React.createElement("div", { className: "vg-sl-live" }, /* @__PURE__ */ React.createElement("div", { className: "vg-sl-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Account", value: s.live_account || "\u2014" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Max $/order", value: s.caps?.max_order_usd ? usd(s.caps.max_order_usd) : "\u2014" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Max positions", value: s.caps?.max_positions ?? "\u2014" }), /* @__PURE__ */ React.createElement(StatTile, { label: "Daily max-loss", value: s.caps?.max_daily_loss_usd ? usd(s.caps.max_daily_loss_usd) : "\u2014" })), !armed && /* @__PURE__ */ React.createElement("p", { className: "vg-note warn" }, "Live stage, but autonomous is NOT armed \u2014 orders record as dry-run only."), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn sm",
        disabled: busy,
        onClick: () => act(() => pauseStrategy(s.strategy_id, { reason: "operator" }))
      },
      "Pause"
    )), stage === "paused" && /* @__PURE__ */ React.createElement("div", { className: "vg-sl-live" }, s.paused_reason && /* @__PURE__ */ React.createElement("p", { className: "vg-note warn" }, "Paused: ", s.paused_reason), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn sm",
        disabled: busy,
        onClick: () => act(() => resumeStrategy(s.strategy_id))
      },
      "Resume"
    )), stage === "eligible" && /* @__PURE__ */ React.createElement(PromoteForm, { sid: s.strategy_id, onDone: onChange }), stage === "paper" && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-sl-gatewhy" }, "In paper validation \u2014 it becomes promotable when the gate passes (paper win-rate beats the frozen backtest baseline over the min sample)."), /* @__PURE__ */ React.createElement(AuditTrail, { sid: s.strategy_id }));
  }
  function LifecycleBoard() {
    const [nonce, setNonce] = useState12(0);
    const refresh = useCallback3(() => setNonce((n) => n + 1), []);
    const q = useLive(() => getLifecycle(), null, [nonce]);
    const d = q.data;
    const strategies = d && d.strategies || [];
    const gates = d && d.gates || {};
    const [ticking, setTicking] = useState12(false);
    const runTick = () => {
      setTicking(true);
      lifecycleTick(false).then(() => {
        setTicking(false);
        refresh();
      }).catch(() => setTicking(false));
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-sl" }, /* @__PURE__ */ React.createElement("div", { className: "vg-sl-topbar" }, /* @__PURE__ */ React.createElement("h2", { className: "vg-sl-h2", style: { fontSize: 16 } }, "Promotion pipeline"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Paper \u2192 gate \u2192 promote \u2192 autonomous \xB7 one lifecycle"), /* @__PURE__ */ React.createElement("button", { className: "vg-btn sm vg-btn-primary", style: { marginLeft: "auto" }, onClick: runTick, disabled: ticking }, ticking ? "Running\u2026" : "Run driver pass (dry-run)")), d && /* @__PURE__ */ React.createElement("div", { className: cls("vg-sl-arm", gates.armed ? "live" : "safe") }, gates.armed ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("b", null, "\u26A1 AUTONOMOUS LIVE ARMED"), " \u2014 promoted strategies place REAL orders within their caps.") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("b", null, "Dry-run (safe)"), " \u2014 autonomous is not armed; orders record what they'd do but reach no broker."), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto" } }, "VANTAGE_LIVE_OK ", gates.live_env ? "\u2713" : "\u2717", " \xB7 VANTAGE_AUTONOMOUS_OK ", gates.autonomous_env ? "\u2713" : "\u2717", "\xB7 kill switch ", gates.kill_switch ? "ENGAGED" : "clear")), q.loading && /* @__PURE__ */ React.createElement(LoadBar, null), d && d.available === false && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: 14 } }, d.note || "The strategy lifecycle needs the SQLite backend."), strategies.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-sl-grid" }, strategies.map((s) => /* @__PURE__ */ React.createElement(StrategyCard2, { key: s.strategy_id, s, armed: !!gates.armed, onChange: refresh }))));
  }

  // src/scanner.jsx
  var { useState: useState13, useEffect: useEffect11 } = React;
  var SCANNERS = [
    { id: "ict_htf", label: "A+ ICT hourly setup" },
    { id: "breakout_hold", label: "Breakout hold \u2014 3 closes above a pivot cluster (long)" },
    { id: "rsi2_mr", label: "RSI(2) dip in uptrend \u2014 time/MA exit (long)" }
  ];
  function ago(iso) {
    if (!iso) return "never";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1e3);
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }
  var hhmm = (iso) => iso ? String(iso).slice(11, 16) : "";
  function SignalCard({ h, onOpen }) {
    const long = h.dir === "long";
    const dir = long ? 1 : -1;
    const z = Array.isArray(h.entry_zone) ? h.entry_zone : null;
    return /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-scan-card", long ? "long" : "short"),
        onClick: () => onOpen && onOpen(h.symbol),
        title: `open ${h.symbol} chart`
      },
      /* @__PURE__ */ React.createElement("div", { className: "vg-scan-cardhead" }, /* @__PURE__ */ React.createElement("span", { className: "vg-scan-sym" }, h.symbol), /* @__PURE__ */ React.createElement("b", { className: cls("vg-scan-dir", dirCls(dir)) }, long ? "LONG" : "SHORT"), h.ob_backed && /* @__PURE__ */ React.createElement("span", { className: "vg-scan-ob", title: "order-block backed" }, "OB")),
      /* @__PURE__ */ React.createElement("div", { className: "vg-scan-nums" }, /* @__PURE__ */ React.createElement("div", { className: "vg-scan-num" }, /* @__PURE__ */ React.createElement("span", { className: "vg-scan-numlbl" }, "entry"), /* @__PURE__ */ React.createElement("span", { className: "vg-scan-numval" }, z ? `${z[0]}\u2013${z[1]}` : h.ce ?? "\u2014")), /* @__PURE__ */ React.createElement("div", { className: "vg-scan-num" }, /* @__PURE__ */ React.createElement("span", { className: "vg-scan-numlbl" }, "invalid"), /* @__PURE__ */ React.createElement("span", { className: "vg-scan-numval down" }, h.invalid ?? "\u2014"))),
      Array.isArray(h.targets) && h.targets.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-scan-ladder" }, h.targets.map((t, i) => {
        const runner = i === h.targets.length - 1;
        return /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-scan-rung" }, /* @__PURE__ */ React.createElement("span", { className: "vg-scan-rung-r" }, runner && h.runner_is_pool ? "draw" : `${t.r ?? "?"}R`), /* @__PURE__ */ React.createElement("span", { className: "vg-scan-rung-px" }, t.price), /* @__PURE__ */ React.createElement("span", { className: "vg-scan-rung-sz" }, t.size != null ? `${Math.round(t.size * 100)}%` : ""));
      })),
      /* @__PURE__ */ React.createElement("div", { className: "vg-scan-foot vg-note" }, "@ ", hhmm(h.as_of), h.bars_ago != null ? ` \xB7 ${h.bars_ago}h ago` : "")
    );
  }
  function TierGroup({ label, hits, onOpen }) {
    const longs = hits.filter((h) => h.dir === "long");
    const shorts = hits.filter((h) => h.dir !== "long");
    const side = (name, list) => list.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-scan-side" }, /* @__PURE__ */ React.createElement("div", { className: "vg-scan-sidehd" }, name, " \xB7 ", list.length), /* @__PURE__ */ React.createElement("div", { className: "vg-scan-grid" }, list.map((h) => /* @__PURE__ */ React.createElement(SignalCard, { key: h.symbol, h, onOpen }))));
    return /* @__PURE__ */ React.createElement("div", { className: "vg-scan-group" }, /* @__PURE__ */ React.createElement("div", { className: "vg-scan-grouphead" }, /* @__PURE__ */ React.createElement("span", { className: "vg-kicker" }, label, " \xB7 ", hits.length), hits[0].reason && /* @__PURE__ */ React.createElement("span", { className: "vg-scan-rationale" }, hits[0].reason)), /* @__PURE__ */ React.createElement("div", { className: "vg-scan-sides" }, side("Long", longs), side("Short", shorts)));
  }
  function HistoryTable({ rows, onOpen }) {
    const tone = (o) => o === "target" ? "good" : o === "invalidated" ? "bad" : "plain";
    const lbl = (o) => o === "target" ? "\u2713 target" : o === "invalidated" ? "\u2715 invalid" : "\xB7 open";
    const [fq, setFq] = useState13("");
    const [fTier, setFTier] = useState13("all");
    const [fDir, setFDir] = useState13("all");
    const [fOut, setFOut] = useState13("all");
    const [open, setOpen] = useState13(null);
    const shown = rows.filter((h) => (!fq || String(h.symbol || "").toUpperCase().includes(fq.toUpperCase())) && (fTier === "all" || h.tier === fTier) && (fDir === "all" || h.dir === fDir) && (fOut === "all" || (h.outcome || "open") === fOut));
    const zone2 = (h) => Array.isArray(h.entry_zone) && h.entry_zone.length === 2 ? `${h.entry_zone[0]}\u2013${h.entry_zone[1]}` : h.ce ?? "\u2014";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-scan-group", style: { marginTop: 20 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-scan-grouphead", style: { flexWrap: "wrap", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-kicker" }, "History \xB7 ", shown.length, shown.length !== rows.length ? ` of ${rows.length}` : ""), /* @__PURE__ */ React.createElement("span", { className: "vg-scan-rationale" }, "setups that aged past current \u2014 how they played out"), /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 6, marginLeft: "auto", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "vg-scan-filter",
        value: fq,
        placeholder: "ticker\u2026",
        onChange: (e) => setFq(e.target.value),
        "aria-label": "Filter by ticker"
      }
    ), /* @__PURE__ */ React.createElement("select", { className: "vg-scan-filter", value: fTier, onChange: (e) => setFTier(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "tier: all"), /* @__PURE__ */ React.createElement("option", { value: "A+" }, "A+"), /* @__PURE__ */ React.createElement("option", { value: "B" }, "B")), /* @__PURE__ */ React.createElement("select", { className: "vg-scan-filter", value: fDir, onChange: (e) => setFDir(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "side: all"), /* @__PURE__ */ React.createElement("option", { value: "long" }, "long"), /* @__PURE__ */ React.createElement("option", { value: "short" }, "short")), /* @__PURE__ */ React.createElement("select", { className: "vg-scan-filter", value: fOut, onChange: (e) => setFOut(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "outcome: all"), /* @__PURE__ */ React.createElement("option", { value: "open" }, "open"), /* @__PURE__ */ React.createElement("option", { value: "target" }, "target"), /* @__PURE__ */ React.createElement("option", { value: "invalidated" }, "invalidated")))), /* @__PURE__ */ React.createElement("div", { className: "vg-scan-histlist" }, shown.map((h) => {
      const key = `${h.symbol}|${h.as_of}`;
      const expanded = open === key;
      return /* @__PURE__ */ React.createElement("div", { key, className: cls("vg-scan-histrow", expanded && "open") }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: "vg-scan-histhead",
          onClick: () => setOpen(expanded ? null : key),
          title: expanded ? "collapse" : "show full setup"
        },
        /* @__PURE__ */ React.createElement(
          "span",
          {
            className: "vg-scan-sym",
            style: { fontSize: 14, cursor: "pointer" },
            onClick: (e) => {
              e.stopPropagation();
              onOpen && onOpen(h.symbol);
            },
            title: `open ${h.symbol} chart`
          },
          h.symbol
        ),
        /* @__PURE__ */ React.createElement("b", { className: cls("vg-scan-dir", dirCls(h.dir === "long" ? 1 : -1)) }, h.tier, " ", h.dir === "long" ? "LONG" : "SHORT"),
        /* @__PURE__ */ React.createElement("span", { className: "vg-note vg-scan-histdetail" }, "entry ", zone2(h), " \xB7 stop ", h.invalid ?? "\u2014", Array.isArray(h.targets) && h.targets.length ? ` \xB7 runner ${h.targets[h.targets.length - 1].price}` : ""),
        /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: "var(--vg-text-xs)" } }, h.bars_ago, "h ago"),
        /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", tone(h.outcome)), style: { fontSize: "var(--vg-text-xs)" } }, lbl(h.outcome)),
        /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, expanded ? "\u25BE" : "\u25B8")
      ), expanded && /* @__PURE__ */ React.createElement("div", { className: "vg-scan-histbody" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginBottom: 4 } }, "triggered ", h.hour || String(h.as_of || "").slice(11, 16), " \xB7", " ", h.ob_backed ? "OB-backed" : "no OB", " \xB7", " ", h.runner_is_pool ? "runner = liquidity pool" : "runner = fixed R"), (h.targets || []).map((t, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-scan-histtgt" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "T", i + 1, " \xB7 ", t.r, "R"), /* @__PURE__ */ React.createElement("b", null, t.price), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, Math.round((t.size || 0) * 100), "%", t.note ? ` \xB7 ${t.note}` : "")))));
    }), !shown.length && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { padding: 12 } }, "no setups match the filters")));
  }
  function ScannerView({ onOpenSymbol }) {
    const [scanner, setScanner] = useState13("ict_htf");
    const [nonce, setNonce] = useState13(0);
    const [note, setNote] = useState13(null);
    const [entry, setEntry] = useState13("");
    const q = useLive(() => getScanner(scanner), null, [scanner, nonce]);
    const d = q.data && q.data.available ? q.data : null;
    const running = d && d.status === "running";
    const prog = d && d.progress || null;
    const hits = d && d.hits || [];
    const aplus = hits.filter((h) => h.tier === "A+");
    const bs = hits.filter((h) => h.tier !== "A+");
    const history = d && d.history || [];
    const manual = d && d.manual_tickers || [];
    const dataThrough = d && d.data_through;
    const staleHrs = dataThrough ? (Date.now() - new Date(dataThrough).getTime()) / 36e5 : 0;
    const isStaleData = staleHrs > 20;
    useEffect11(() => {
      if (!running) return void 0;
      const id = setInterval(() => setNonce((n) => n + 1), 3e3);
      return () => clearInterval(id);
    }, [running]);
    const refresh = (refreshUniverse = false) => {
      setNote(null);
      refreshScanner(scanner, refreshUniverse).then((r) => {
        if (r && r.status === "already_running") setNote("a scan is already running\u2026");
        setNonce((n) => n + 1);
      }).catch((e) => setNote(String(e && e.message || e)));
    };
    const addTicker = () => {
      const s = entry.trim().toUpperCase();
      if (!s) return;
      setEntry("");
      addScannerTicker(s).then(() => setNonce((n) => n + 1)).catch((e) => setNote(String(e && e.message || e)));
    };
    const removeTicker = (s) => removeScannerTicker(s).then(() => setNonce((n) => n + 1)).catch(() => {
    });
    const pct7 = prog && prog.total ? Math.round(prog.done / prog.total * 100) : 0;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-loadhost" }, (q.loading || running) && /* @__PURE__ */ React.createElement(LoadBar, null), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 12, flexWrap: "wrap", gap: 10 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Strategies"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { margin: "4px 0 0" } }, "Backtest-validated setups scanned across the Nasdaq-100 + S&P top-100 \u2014 executed on paper below, promoted to real money when the gate passes."))), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-scan-strip", style: { padding: 12, marginBottom: 12 } }, /* @__PURE__ */ React.createElement(
      "select",
      {
        value: scanner,
        onChange: (e) => setScanner(e.target.value),
        "aria-label": "scanner type",
        className: "vg-fc-syminput",
        style: { width: "auto" }
      },
      SCANNERS.map((s) => /* @__PURE__ */ React.createElement("option", { key: s.id, value: s.id }, s.label))
    ), running ? /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, prog ? `${prog.phase}\u2026 ${prog.done}/${prog.total}` : "scanning\u2026") : d ? /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "covered ", /* @__PURE__ */ React.createElement("b", null, d.covered_n), "/", /* @__PURE__ */ React.createElement("b", null, d.universe_n), " \xB7 ", aplus.length, " A+ \xB7 ", bs.length, " B \xB7 last run ", ago(d.ran_at), isStaleData && dataThrough && /* @__PURE__ */ React.createElement("span", { className: "vg-scan-stale" }, " \xB7 \u26A0 data through ", hhmm(dataThrough), " ", String(dataThrough).slice(5, 10), " (market closed \u2014 setups as of then)")) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "no scan yet \u2014 run a refresh to seed data + scan"), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm vg-btn-primary",
        disabled: running,
        onClick: () => refresh(false),
        style: { marginLeft: "auto" }
      },
      running ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"), " Scanning\u2026 (", pct7, "%)") : "\u27F3 Refresh scan"
    )), running && /* @__PURE__ */ React.createElement("div", { className: "vg-fc-progress", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-fc-progress-bar", style: { width: `${pct7}%` } })), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-scan-manual", style: { padding: 12, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 600 } }, "Watch tickers"), /* @__PURE__ */ React.createElement(
      "form",
      {
        style: { display: "inline-flex", gap: 6 },
        onSubmit: (e) => {
          e.preventDefault();
          addTicker();
        }
      },
      /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "vg-fc-syminput",
          value: entry,
          spellCheck: false,
          onChange: (e) => setEntry(e.target.value.toUpperCase()),
          placeholder: "add ticker",
          "aria-label": "add scanner ticker",
          style: { width: 110 }
        }
      ),
      /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", type: "submit" }, "\uFF0B add")
    ), manual.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-scan-chips" }, manual.map((s) => /* @__PURE__ */ React.createElement("span", { key: s, className: "vg-scan-chip" }, s, /* @__PURE__ */ React.createElement("button", { className: "vg-scan-chip-x", title: "remove", onClick: () => removeTicker(s) }, "\u2715")))), manual.length === 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "none \u2014 add ad-hoc names to always scan them.")), note && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { color: "var(--vg-down)", marginBottom: 10 } }, note), aplus.length > 0 && /* @__PURE__ */ React.createElement(TierGroup, { label: "A+ setups", hits: aplus, onOpen: onOpenSymbol }), bs.length > 0 && /* @__PURE__ */ React.createElement(TierGroup, { label: "B setups", hits: bs, onOpen: onOpenSymbol }), d && hits.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { padding: 18 } }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "No CURRENT hourly setups across ", d.covered_n, " covered tickers. A+ is a high-conviction, deliberately rare tier \u2014 a quiet scan is normal.", history.length > 0 && " Recently-played-out setups are in history below.")), history.length > 0 && /* @__PURE__ */ React.createElement(HistoryTable, { rows: history, onOpen: onOpenSymbol }), d && (d.no_data || []).length > 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 12, fontSize: 12, color: "var(--vg-dim)" } }, "no data (", d.no_data.length, "): ", d.no_data.join(", "), " \u2014 hourly bars not fetched yet; refresh to seed."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, fontSize: 12, color: "var(--vg-dim)" } }, "Hourly setups (validated timeframe) \xB7 a heads-up to drop to a lower timeframe for entry \xB7 not advice."), /* @__PURE__ */ React.createElement(ScannerSpreadBook, { refreshNonce: 0, alwaysShow: true }), /* @__PURE__ */ React.createElement("details", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, "Reclaim paper book (playbook tickets)"), /* @__PURE__ */ React.createElement(PaperView, { refreshNonce: 0 })), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 16 } }, /* @__PURE__ */ React.createElement(LifecycleBoard, null)));
  }

  // src/chart_replay_panel.jsx
  var { useState: useState14, useEffect: useEffect12, useRef: useRef4, useCallback: useCallback4 } = React;
  var REPLAY_SYMBOLS2 = ["SPX", "QQQ", "IWM"];
  function verdictTone2(sc) {
    if (!sc) return "plain";
    if (sc.verdict === "hit target" || sc.verdict === "direction correct") return "good";
    if (sc.verdict === "invalidated" || sc.verdict === "direction wrong") return "bad";
    return "plain";
  }
  function CallRow({ f, onScore, scoring, active, onActivate }) {
    const [open, setOpen] = useState14(false);
    const sc = f.score;
    const tone = verdictTone2(sc);
    return /* @__PURE__ */ React.createElement("div", { className: cls("vg-rp-call", active && "on") }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "vg-rp-callhead",
        onClick: () => onActivate(active ? null : f.id),
        title: active ? "stop highlighting on chart" : "highlight this call on the chart"
      },
      /* @__PURE__ */ React.createElement("span", { className: "vg-rp-time" }, String(f.as_of || "").slice(11, 16)),
      /* @__PURE__ */ React.createElement("span", { className: "vg-rp-px" }, "@ ", f.price_at),
      sc ? /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", tone), style: { fontSize: 12 } }, sc.verdict, sc.moved_pt != null ? ` \xB7 ${sc.moved_pt >= 0 ? "+" : ""}${sc.moved_pt}pt` : "") : /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-btn-sm",
          disabled: scoring === f.id,
          onClick: (e) => {
            e.stopPropagation();
            onScore(f.id);
          }
        },
        scoring === f.id ? "\u2026" : "score it"
      ),
      /* @__PURE__ */ React.createElement(
        "span",
        {
          className: "vg-rp-caret",
          title: "show the written read",
          onClick: (e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }
        },
        open ? "\u25BE" : "\u25B8"
      )
    ), open && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-callbody" }, /* @__PURE__ */ React.createElement(MiraRender, { data: f.forecast, text: f.forecast_text })));
  }
  function ReplayPanel({ symbol, runId, setRunId, activeCallId, setActiveCallId, forecastSignal, onForecastSaved }) {
    const [scoring, setScoring] = useState14(null);
    const [nonce, setNonce] = useState14(0);
    const runningRef = useRef4(false);
    const genRunRef = useRef4(null);
    const forecastModeRef = useRef4(false);
    const fcSigRef = useRef4(null);
    if (forecastSignal && forecastSignal !== fcSigRef.current) forecastModeRef.current = true;
    const runsQ = useLive(() => getReplayRuns(40), null, [nonce]);
    useEffect12(() => {
      const onFocus = () => setNonce((n) => n + 1);
      window.addEventListener("focus", onFocus);
      return () => window.removeEventListener("focus", onFocus);
    }, []);
    const runs = (runsQ.data && runsQ.data.runs || []).filter((r) => String(r.symbol || "").toUpperCase() === String(symbol || "").toUpperCase());
    useEffect12(() => {
      if (!runs.length || runId || runningRef.current || genRunRef.current) return;
      if (forecastModeRef.current) return;
      setRunId(runs[0].run_id);
    }, [runs, runId]);
    const runQ = useLive(() => runId ? getReplayRun(runId) : Promise.resolve(null), null, [runId, nonce]);
    const detail = runQ.data && runQ.data.available ? runQ.data : null;
    const forecasts = detail && detail.forecasts || [];
    const cal = detail && detail.calibration;
    const score = (fid) => {
      setScoring(fid);
      scoreSpxForecast(fid).then(() => setNonce((n) => n + 1)).finally(() => setScoring(null));
    };
    const scored = forecasts.filter((f) => f.score);
    const hits = scored.filter((f) => verdictTone2(f.score) === "good").length;
    const hitRate = scored.length ? Math.round(hits / scored.length * 100) : null;
    const [gen, setGen] = useState14(null);
    const [showGen, setShowGen] = useState14(false);
    const [genDay, setGenDay] = useState14(() => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
    const [stepMin, setStepMin] = useState14(60);
    const [note, setNote] = useState14(null);
    const [grade, setGrade] = useState14(null);
    const [gradeOpen, setGradeOpen] = useState14(true);
    const stopRef = useRef4(false);
    const abortRef = useRef4(null);
    useEffect12(() => () => {
      stopRef.current = true;
      if (abortRef.current) abortRef.current();
    }, []);
    const [fc, setFc] = useState14(null);
    const canForecast = REPLAY_SYMBOLS2.includes(String(symbol || "").toUpperCase());
    const priorsQ = useLive(
      () => canForecast ? getSpxForecasts(void 0, symbol, 20) : Promise.resolve(null),
      null,
      [symbol, nonce, canForecast]
    );
    const priors = priorsQ.data && priorsQ.data.forecasts || [];
    const forecastNow = useCallback4(() => {
      if (!canForecast) return;
      setFc({ loading: true, text: "" });
      refreshSpx(symbol).then((r) => {
        const day = r && r.available && r.day || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const asOf = r && r.available && r.as_of || void 0;
        return getSpxSnapshot(day, asOf, symbol).then((snapEnv) => {
          const snapshot = snapEnv && snapEnv.available ? snapEnv : null;
          if (!snapshot) {
            setFc({ error: `No snapshot for ${symbol} \u2014 try again during market hours.` });
            return;
          }
          const ref = `SPX_SNAPSHOT_REF day=${snapshot.day} as_of=${snapshot.as_of} underlying=${symbol}`;
          const prompt = buildForecastPrompt(symbol, ref);
          return collectTurn(prompt, `forecast-${symbol}-${snapshot.as_of}`, {
            onToken: (text) => setFc({ loading: true, text }),
            setAbort: (fn) => {
              abortRef.current = fn;
            }
          }).then(({ text, data, error }) => {
            if (error && !text) {
              setFc({ error });
              return;
            }
            setFc({ text, data });
            saveSpxForecast({
              day: snapshot.day,
              as_of: snapshot.as_of,
              symbol,
              snapshot,
              forecast: data || null,
              forecast_text: text
            }).then(() => {
              setNonce((n) => n + 1);
              onForecastSaved && onForecastSaved();
            }).catch(() => {
            });
          });
        });
      }).catch((e) => setFc({ error: String(e && e.message || e) }));
    }, [symbol, canForecast]);
    useEffect12(() => {
      if (!forecastSignal || forecastSignal === fcSigRef.current) return;
      fcSigRef.current = forecastSignal;
      if (!canForecast) return;
      setRunId(null);
      setActiveCallId(null);
      forecastNow();
    }, [forecastSignal, canForecast, forecastNow]);
    const forecastStep = useCallback4((asOf, rid, day) => new Promise((resolve) => {
      getSpxSnapshot(day, asOf, symbol).then((snapEnv) => {
        const snapshot = snapEnv && snapEnv.available ? snapEnv : null;
        if (!snapshot) {
          resolve(false);
          return;
        }
        const ref = `SPX_SNAPSHOT_REF day=${day} as_of=${asOf} underlying=${symbol}`;
        const prompt = buildForecastPrompt(symbol, ref);
        collectTurn(prompt, `replay-${symbol}-${day}-${asOf}`, {
          setAbort: (fn) => {
            abortRef.current = fn;
          }
        }).then(({ text, data, error }) => {
          if (error && !text) {
            resolve(false);
            return;
          }
          saveSpxForecast({
            day,
            as_of: asOf,
            symbol,
            snapshot,
            forecast: data || null,
            forecast_text: text,
            run_id: rid
          }).then(() => resolve(true)).catch(() => resolve(false));
        });
      }).catch(() => resolve(false));
    }), [symbol]);
    const generate = useCallback4(() => {
      if (runningRef.current) return;
      runningRef.current = true;
      setNote(null);
      setGrade(null);
      stopRef.current = false;
      setGen({ status: "planning", total: 0, done: 0, day: genDay });
      planReplay(genDay, symbol, false, stepMin).then(async (plan) => {
        if (!plan || !plan.available) {
          setGen(null);
          setNote(plan && plan.note || "Couldn't plan a run for that day.");
          runningRef.current = false;
          return;
        }
        const rid = plan.run_id;
        genRunRef.current = rid;
        setRunId(rid);
        setActiveCallId(null);
        setShowGen(false);
        const steps = plan.steps || [];
        let existing = [];
        try {
          const g = await getReplayRun(rid);
          existing = g && g.forecasts || [];
        } catch (e) {
        }
        const done0 = new Set(existing.map((f) => f.as_of));
        setGen({ status: "running", total: steps.length, done: done0.size, day: genDay });
        let stopped = false;
        for (let k = 0; k < steps.length; k++) {
          if (stopRef.current) {
            stopped = true;
            break;
          }
          const asOf = steps[k].as_of;
          if (!done0.has(asOf)) {
            setGen((g) => ({ ...g, at: String(asOf).slice(11, 16) }));
            await forecastStep(asOf, rid, genDay);
            setNonce((x) => x + 1);
          }
          setGen((g) => ({ ...g, done: k + 1 }));
        }
        if (!stopped) {
          try {
            await scoreReplay(rid);
          } catch (e) {
          }
          setGen((g) => ({ ...g || {}, status: "done", done: steps.length, total: steps.length }));
          setNonce((x) => x + 1);
        } else {
          setGen((g) => ({ ...g || {}, status: "stopped" }));
        }
      }).catch((e) => {
        setGen(null);
        setNote(String(e && e.message || e));
      }).finally(() => {
        runningRef.current = false;
        genRunRef.current = null;
        setNonce((x) => x + 1);
      });
    }, [genDay, stepMin, symbol, forecastStep, setRunId, setActiveCallId]);
    const stopGen = useCallback4(() => {
      stopRef.current = true;
      runningRef.current = false;
      if (abortRef.current) abortRef.current();
      setGen((g) => g ? { ...g, status: "stopped" } : g);
    }, []);
    const gradeRun = useCallback4(() => {
      if (!runId) return;
      setGrade({ loading: true, text: "" });
      setGradeOpen(true);
      calibrateReplay(runId).then(() => {
        const ref = `FORECAST_GRADE_REF run_id=${runId}`;
        const prompt = `Grade this replay forecast run \u2014 how did the analyst's read evolve through the day? Read the code-computed scores and narrate them.
${ref}`;
        collectTurn(prompt, `grade-${runId}`, {
          onToken: (text) => setGrade({ loading: true, text }),
          setAbort: (fn) => {
            abortRef.current = fn;
          }
        }).then(({ text, data, error }) => {
          if (error && !text) {
            setGrade({ error });
            return;
          }
          setGrade({ text, data });
          const narrative = data && data.headline || (text || "").replace(/\s+/g, " ").slice(0, 800) || null;
          calibrateReplay(runId, { narrative }).then(() => setNonce((x) => x + 1)).catch(() => setNonce((x) => x + 1));
        });
      }).catch((e) => setGrade({ error: String(e && e.message || e) }));
    }, [runId]);
    const genBusy = gen && (gen.status === "planning" || gen.status === "running");
    const gradeText = grade && grade.text || cal && cal.narrative || null;
    const forecastControls = canForecast && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-forecast" }, /* @__PURE__ */ React.createElement("div", { className: "vg-rp-fchead" }, /* @__PURE__ */ React.createElement("span", { className: "vg-rp-fclabel" }, "Forecast \xB7 ", symbol), fc && fc.loading ? /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto" } }, "forecasting\u2026") : /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm on",
        style: { marginLeft: "auto" },
        onClick: forecastNow,
        title: `Forecast ${symbol} from now \u2014 calls Mira`
      },
      "\u{1F52E} Forecast now"
    )), fc && fc.loading && !fc.text && /* @__PURE__ */ React.createElement(LoadBar, null), fc && fc.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-rp-gennote" }, fc.error), fc && fc.text && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-fcread" }, /* @__PURE__ */ React.createElement(MiraRender, { data: fc.data, text: fc.text })), priors.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-priors" }, /* @__PURE__ */ React.createElement("div", { className: "vg-note vg-rp-priorlbl" }, "Prior forecasts"), priors.map((f) => /* @__PURE__ */ React.createElement(
      CallRow,
      {
        key: f.id,
        f,
        onScore: score,
        scoring,
        active: activeCallId === f.id,
        onActivate: setActiveCallId
      }
    ))));
    const genControls = /* @__PURE__ */ React.createElement("div", { className: "vg-rp-gen" }, !showGen && !genBusy && /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => setShowGen(true) }, "\uFF0B New replay"), showGen && !genBusy && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-genform" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        className: "vg-rp-date",
        value: genDay,
        max: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        onChange: (e) => setGenDay(e.target.value)
      }
    ), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "vg-rp-step",
        value: stepMin,
        onChange: (e) => setStepMin(Number(e.target.value)),
        title: "Forecast interval \u2014 5m is ~78 Mira calls for a full session (slow + costly); coarser steps are cheaper"
      },
      /* @__PURE__ */ React.createElement("option", { value: 5 }, "5m"),
      /* @__PURE__ */ React.createElement("option", { value: 15 }, "15m"),
      /* @__PURE__ */ React.createElement("option", { value: 30 }, "30m"),
      /* @__PURE__ */ React.createElement("option", { value: 60 }, "1h")
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm on",
        onClick: generate,
        title: `Forecast ${symbol} across ${genDay} \u2014 calls Mira per step`
      },
      "Generate"
    ), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => setShowGen(false) }, "cancel")), genBusy && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-genprog" }, /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, gen.status === "planning" ? "planning\u2026" : `forecasting ${gen.done}/${gen.total}${gen.at ? ` \xB7 ${gen.at}` : ""}`), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: stopGen }, "Stop")), note && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-rp-gennote" }, note));
    if (!runs.length) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-rp" }, /* @__PURE__ */ React.createElement("div", { className: "vg-rp-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-rp-title" }, "Chart \xB7 ", symbol)), forecastControls, genControls, !REPLAY_SYMBOLS2.includes(String(symbol || "").toUpperCase()) && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "4px 14px" } }, "Replay needs a coach snapshot \u2014 SPX / QQQ / IWM."), REPLAY_SYMBOLS2.includes(String(symbol || "").toUpperCase()) && !genBusy && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "4px 14px" } }, "No saved runs for ", symbol, ". Generate one \u2014 it steps the day and forecasts at each interval."));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "vg-rp" }, /* @__PURE__ */ React.createElement("div", { className: "vg-rp-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-rp-title" }, "Replay \xB7 ", symbol), /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "vg-rp-runpick",
        value: runId || "",
        onChange: (e) => {
          forecastModeRef.current = false;
          setRunId(e.target.value || null);
          setActiveCallId(null);
        }
      },
      runs.map((r, i) => /* @__PURE__ */ React.createElement("option", { key: r.run_id, value: r.run_id }, r.day, r.live ? " \xB7 LIVE session" : "", i === 0 ? " (latest)" : "", " \xB7 ", r.n, " calls", r.n_scored ? ` \xB7 ${r.n_scored} scored` : ""))
    )), forecastControls, genControls, runsQ.loading && /* @__PURE__ */ React.createElement(LoadBar, null), runId && runQ.loading && !genBusy && /* @__PURE__ */ React.createElement(LoadBar, null), detail && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-rp-summary" }, /* @__PURE__ */ React.createElement("span", { className: "vg-rp-day" }, detail.forecasts[0] && detail.forecasts[0].day), /* @__PURE__ */ React.createElement("span", { className: "vg-rp-stat" }, forecasts.length, " calls \xB7 ", scored.length, " scored"), hitRate != null && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", hitRate >= 50 ? "good" : "bad") }, hitRate, "% hit")), /* @__PURE__ */ React.createElement("div", { className: "vg-rp-gradeblock" }, /* @__PURE__ */ React.createElement("div", { className: "vg-rp-gradehead" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-rp-gradelabel",
        onClick: () => gradeText && setGradeOpen((v) => !v),
        style: { cursor: gradeText ? "pointer" : "default" }
      },
      gradeText && /* @__PURE__ */ React.createElement("span", { className: "vg-rp-caret" }, gradeOpen ? "\u25BE" : "\u25B8"),
      "Run analysis"
    ), grade && grade.loading ? /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto" } }, "grading\u2026") : /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        style: { marginLeft: "auto" },
        onClick: gradeRun,
        disabled: !!genBusy
      },
      gradeText ? "re-grade" : "grade run"
    )), grade && grade.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-rp-gennote" }, grade.error), gradeText && gradeOpen && /* @__PURE__ */ React.createElement("div", { className: "vg-rp-grade" }, grade && grade.data ? /* @__PURE__ */ React.createElement(MiraRender, { data: grade.data, text: grade.text }) : /* @__PURE__ */ React.createElement(MiraRender, { text: gradeText })), !gradeText && !(grade && grade.loading) && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-rp-gradehint" }, "How did the read evolve across the day? Grade it for Mira's narrative.")), /* @__PURE__ */ React.createElement("div", { className: "vg-rp-calls" }, forecasts.map((f) => /* @__PURE__ */ React.createElement(
      CallRow,
      {
        key: f.id,
        f,
        onScore: score,
        scoring,
        active: activeCallId === f.id,
        onActivate: setActiveCallId
      }
    )))));
  }

  // src/futures.jsx
  var { useState: useState15 } = React;
  var pct4 = (v) => v == null ? "\u2014" : `${Math.round(100 * v)}%`;
  var usd3 = (v) => v == null ? "\u2014" : `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
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
  function EquityCurve2({ curve }) {
    if (!curve || curve.length < 2) return null;
    const W = 640, H = 130, pad = 6;
    const xs = curve.map((p) => p.cum);
    const peaks = curve.map((p) => p.peak);
    const lo = Math.min(0, ...xs), hi = Math.max(...peaks, ...xs);
    const range = hi - lo || 1;
    const x = (i) => pad + i / (curve.length - 1) * (W - 2 * pad);
    const y = (v) => H - pad - (v - lo) / range * (H - 2 * pad);
    const line2 = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
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
      /* @__PURE__ */ React.createElement("path", { d: line2(peaks), fill: "none", stroke: "currentColor", strokeOpacity: "0.25", strokeWidth: "1", strokeDasharray: "3 3" }),
      /* @__PURE__ */ React.createElement("path", { d: line2(xs), fill: "none", stroke: areaCol, strokeWidth: "1.75" })
    );
  }
  function FuturesView({ refreshNonce }) {
    const [nonce, setNonce] = useState15(0);
    const [busy, setBusy] = useState15(false);
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-playbook" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pb-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Futures performance"), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, a ? `${ov.n || 0} round-trips` : "loading\u2026", a && a.tzNote ? " \xB7 times ET" : ""), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, marginTop: 8 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy, onClick: reimport }, busy ? "Re-importing\u2026" : "Re-import CSVs")))), /* @__PURE__ */ React.createElement("div", { className: "vg-stats", style: { margin: "12px 0" } }, /* @__PURE__ */ React.createElement(
      SummaryTile2,
      {
        termKey: "expectancy",
        label: "Expectancy / trade",
        value: usd3(ov.expectancy_usd),
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
    ), /* @__PURE__ */ React.createElement(SummaryTile2, { termKey: "win_rate", label: "Win rate", value: pct4(ov.win_rate), tone: ov.win_rate >= 0.5 ? "good" : "bad" }), /* @__PURE__ */ React.createElement(SummaryTile2, { termKey: "profit_factor", label: "Profit factor", value: ov.profit_factor ?? "\u2014", tone: ov.profit_factor >= 1.3 ? "good" : "warn" }), /* @__PURE__ */ React.createElement(
      SummaryTile2,
      {
        termKey: "drawdown",
        label: "Max drawdown",
        value: usd3(dd.max_drawdown),
        sub: dd.max_drawdown_pct != null ? `${dd.max_drawdown_pct}%` : "",
        tone: "bad"
      }
    )), a && rec.reconciled === false && /* @__PURE__ */ React.createElement("div", { className: "vg-pb-catalyst" }, "\u26A0\uFE0F ", /* @__PURE__ */ React.createElement("b", null, "Partial data:"), " ", rec.caveat), a && a.equityCurve && a.equityCurve.length > 1 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Equity curve \u2014 cumulative P&L", " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "(final ", usd3(ov.total_pnl_dollars), "; dashed = running peak)")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, color: "var(--color-text, #888)" } }, /* @__PURE__ */ React.createElement(EquityCurve2, { curve: a.equityCurve }))), (recs.rules.length > 0 || recs.coaching.length > 0) && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Recommendations to improve your win rate"), recs.rules.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginBottom: 4 } }, "RULES (from your numbers)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, recs.rules.map((r, i) => /* @__PURE__ */ React.createElement(RecRow, { key: i, r, icon: "\u2192" })))), recs.coaching.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginBottom: 4 } }, "DO MORE / DO LESS"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 8 } }, recs.coaching.map((r, i) => /* @__PURE__ */ React.createElement(RecRow, { key: i, r, icon: "\u2022" }))))), risk.available && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Risk & discipline"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement(
      RiskRow,
      {
        label: "Biggest single loss",
        value: `${usd3(risk.worst_loss_usd)} (${Math.abs(risk.worst_loss_pts)}pt)`,
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
    ))), recs.watch && recs.watch.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Next-session watch (generic NQ playbook)"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gap: 4, marginTop: 6, fontSize: 14, lineHeight: 1.5 } }, recs.watch.map((w, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: i === recs.watch.length - 1 ? "vg-note" : "" }, w.text)))), proj.available && (proj.zones || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, proj.contract, " levels \u2014 from the ", proj.etf, " 0DTE playbook (\xD7", proj.ratio, ")"), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, proj.zones.sort((x, y) => (y.price || 0) - (x.price || 0)).map((z, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", z.role === "resistance" ? "bad" : z.role === "support" ? "good" : "plain"),
        style: { minWidth: 74, textAlign: "center" }
      },
      z.role
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontVariantNumeric: "tabular-nums" } }, Math.round(z.lo), "\u2013", Math.round(z.hi)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, (z.kinds || []).join(" \xB7 "))))), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginTop: 6, lineHeight: 1.5 } }, proj.note)), DIM_ORDER.filter((d) => byDim[d] && byDim[d].length).map((d) => /* @__PURE__ */ React.createElement("details", { key: d, className: "vg-card", open: d === "exit_type" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-kicker", style: { cursor: "pointer" } }, DIM_LABEL[d] || d), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-ladder", style: { marginTop: 6 } }, byDim[d].sort((x, y) => y.n - x.n).map((b, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", b.win_rate >= (baseline || 0.5) ? "good" : "bad"),
        style: { minWidth: 46, textAlign: "center" }
      },
      pct4(b.win_rate)
    ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, relabel(b.value)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, "n=", b.n, " \xB7 net ", usd3(b.total_pnl), b.n < 5 ? " \xB7 thin" : "")))))), ob.available && /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Order behavior"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, lineHeight: 1.6, marginTop: 4 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Cancel rate:"), " ", pct4(ob.cancel_rate), " (", ob.cancelled, " of ", ob.total_orders, " orders)"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("b", null, "Filled:"), " ", ob.filled, " \xB7 ", /* @__PURE__ */ React.createElement("b", null, "Stop orders:"), " ", ob.stop_orders))), /* @__PURE__ */ React.createElement(GlossaryCard, { terms: [
      "expectancy",
      "reward_risk",
      "profit_factor",
      "drawdown",
      "win_rate"
    ] }), /* @__PURE__ */ React.createElement("div", { className: "vg-pb-caveats" }, /* @__PURE__ */ React.createElement("div", null, "P&L is gross of commissions (not in the AMP export). Times are ET. Reward:risk and edges use points so micro/mini aren't conflated."), /* @__PURE__ */ React.createElement("div", null, "Context for reviewing your trading, not a signal (ADR-010). Reads your CSV export; places no orders.")));
  }
  function RecRow({ r, icon }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { opacity: 0.6, fontSize: 14 } }, icon), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, lineHeight: 1.45 } }, r.text), r.evidence && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12 } }, r.evidence)));
  }
  function RiskRow({ label, value, note, bad }) {
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pb-lvl" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, minWidth: 150 } }, label), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", bad ? "bad" : "plain"), style: { textAlign: "center" } }, value), note && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: "auto", fontSize: 12 } }, note));
  }
  function SummaryTile2({ label, value, sub, tone, termKey }) {
    return /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: termKey ? /* @__PURE__ */ React.createElement(Term, { k: termKey }, label) : label,
        value,
        note: sub,
        tone
      }
    );
  }

  // src/journal.jsx
  var { useState: useState16, useRef: useRef5, useEffect: useEffect13, useMemo: useMemo4 } = React;
  var pct5 = (v) => v == null ? "\u2014" : `${Math.round(100 * v)}%`;
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
  var todayISO2 = () => new Intl.DateTimeFormat(
    "en-CA",
    { timeZone: "America/New_York" }
  ).format(/* @__PURE__ */ new Date());
  function dayTone(snap) {
    const sc = snap && snap.scorecard;
    if (!sc) return null;
    const regimeOk = sc.regime ? sc.regime.correct : null;
    const lvl = sc.level_accuracy;
    if (regimeOk === true && (lvl == null || lvl >= 0.5)) return "good";
    if (regimeOk === false || lvl != null && lvl < 0.34) return "bad";
    return "warn";
  }
  function JournalView({ refreshNonce, tab: routeTab, onTab }) {
    const [nonce, setNonce] = useState16(0);
    const [busy, setBusy] = useState16("");
    const [sym, setSym] = useState16("SPX");
    const [localTab, setLocalTab] = useState16("days");
    const tab = routeTab || localTab;
    const setTab = onTab || setLocalTab;
    const [selDay, setSelDay] = useState16(todayISO2());
    const now = /* @__PURE__ */ new Date();
    const [view, setView] = useState16({ y: now.getFullYear(), m: now.getMonth() });
    const jv = useLive(() => getJournal(sym), null, [refreshNonce, nonce, sym]);
    const d = jv.data;
    const reload = () => setNonce((n) => n + 1);
    const ensuredRef = useRef5({});
    useEffect13(() => {
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-jr vg-loadhost" }, jv.loading && /* @__PURE__ */ React.createElement(LoadBar, null), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-topbar" }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 12, alignItems: "center" } }, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 18 } }, "Trading journal"), /* @__PURE__ */ React.createElement("div", { className: "vg-seg" }, /* @__PURE__ */ React.createElement("button", { className: cls("vg-seg-btn", tab === "days" && "on"), onClick: () => setTab("days") }, "Days"), /* @__PURE__ */ React.createElement("button", { className: cls("vg-seg-btn", tab === "analysis" && "on"), onClick: () => setTab("analysis") }, "Analysis"))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, alignItems: "center" } }, tab === "days" && /* @__PURE__ */ React.createElement(
      MonthJump,
      {
        view,
        setView,
        byDay,
        selDay,
        onSelect: setSelDay
      }
    ))), tab === "analysis" ? /* @__PURE__ */ React.createElement(JournalAnalysisPanel, { sym }) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DayStrip, { byDay, selDay, onSelect: setSelDay, sym: void 0 }), selSnap ? /* @__PURE__ */ React.createElement(
      DayDetail,
      {
        key: selSnap.id,
        s: selSnap,
        busy,
        onDelete: doDelete,
        onSaveEntry: doSaveEntry,
        onAttach: doAttach
      }
    ) : /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { padding: "20px 2px" } }, selDay === todayISO2() ? d ? "Setting up today's entry \u2014 it freezes last night's forecast and scores it against today's SPX price\u2026" : "loading\u2026" : `No journal entry for ${selDay}.`)));
  }
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function DayStrip({ byDay, selDay, onSelect, sym }) {
    const stripRef = useRef5(null);
    const [pnl, setPnl] = useState16({});
    const days = useMemo4(() => {
      const out = [];
      const d = /* @__PURE__ */ new Date();
      while (out.length < 14) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) {
          out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
        }
        d.setDate(d.getDate() - 1);
      }
      return out;
    }, []);
    useEffect13(() => {
      let live = true;
      (async () => {
        const v = await getDayPnl(days, sym);
        if (live && v && v.pnl) setPnl(v.pnl);
      })();
      return () => {
        live = false;
      };
    }, [days.join(","), sym]);
    useEffect13(() => {
      const el = stripRef.current && stripRef.current.querySelector(".vg-daystrip-pill.sel");
      if (el) el.scrollIntoView({ inline: "center", block: "nearest" });
    }, [selDay]);
    const money7 = (n) => `${n >= 0 ? "+" : "\u2212"}$${Math.abs(n) >= 1e3 ? (Math.abs(n) / 1e3).toFixed(1) + "k" : Math.abs(n).toFixed(0)}`;
    const today = todayISO2();
    return /* @__PURE__ */ React.createElement("div", { className: "vg-daystrip", ref: stripRef }, days.map((iso) => {
      const snap = byDay[iso];
      const tone = snap ? dayTone(snap) : null;
      const p = pnl[iso];
      const [y, m, dd] = iso.split("-");
      const wd = WD[new Date(Number(y), Number(m) - 1, Number(dd)).getDay()];
      const traded = p && p.trades > 0;
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: iso,
          className: cls(
            "vg-daystrip-pill",
            iso === selDay && "sel",
            iso === today && "today",
            traded && (p.realized >= 0 ? "up" : "down")
          ),
          onClick: () => onSelect(iso)
        },
        /* @__PURE__ */ React.createElement("span", { className: "vg-daystrip-wd" }, iso === today ? "Today" : wd),
        /* @__PURE__ */ React.createElement("span", { className: "vg-daystrip-date" }, MONTHS[Number(m) - 1].slice(0, 3), " ", Number(dd)),
        traded ? /* @__PURE__ */ React.createElement("span", { className: cls("vg-daystrip-pnl", p.realized >= 0 ? "vg-up" : "vg-down") }, money7(p.realized)) : /* @__PURE__ */ React.createElement("span", { className: cls("vg-daystrip-dot", tone || "empty") })
      );
    }));
  }
  function MonthJump({ view, setView, byDay, selDay, onSelect }) {
    const [open, setOpen] = useState16(false);
    return /* @__PURE__ */ React.createElement("div", { className: "vg-monthjump" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        onClick: () => setOpen(!open),
        title: "Jump to a past day"
      },
      "\u{1F4C5} ",
      MONTHS[view.m].slice(0, 3)
    ), open && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-monthjump-backdrop", onClick: () => setOpen(false) }), /* @__PURE__ */ React.createElement("div", { className: "vg-monthjump-pop" }, /* @__PURE__ */ React.createElement(
      Calendar,
      {
        view,
        setView,
        byDay,
        selDay,
        onSelect: (d) => {
          onSelect(d);
          setOpen(false);
        }
      }
    ))));
  }
  function Calendar({ view, setView, byDay, selDay, onSelect }) {
    const { y, m } = view;
    const first = new Date(y, m, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = todayISO2();
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
    const [entry, setEntry] = useState16(s.entry || {});
    const [thoughts, setThoughts] = useState16(() => {
      try {
        return JSON.parse((s.entry || {}).trades || "{}");
      } catch (e) {
        return {};
      }
    });
    const [drag, setDrag] = useState16(false);
    const fileRef = useRef5(null);
    useEffect13(() => {
      setEntry(s.entry || {});
      try {
        setThoughts(JSON.parse((s.entry || {}).trades || "{}"));
      } catch (e) {
        setThoughts({});
      }
    }, [s.id, JSON.stringify(s.entry || {})]);
    const set = (k, v) => setEntry((e) => ({ ...e, [k]: v }));
    const setThought = (key, v) => setThoughts((t) => ({ ...t, [key]: v }));
    const save = async () => {
      const clean = {};
      for (const [k] of ENTRY_FIELDS) {
        const v = (entry[k] || "").trim();
        if (v) clean[k] = v;
      }
      const kept = Object.fromEntries(Object.entries(thoughts).filter(([, v]) => (v || "").trim()));
      if (Object.keys(kept).length) clean.trades = JSON.stringify(kept);
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-jr-detail" }, /* @__PURE__ */ React.createElement("div", { className: "vg-jr-dayhead" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-jr-dayname" }, dayLabel === todayISO2() ? "Today" : dayLabel), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 13 } }, s.session ? `${s.session} playbook \xB7 ` : "", "vs. ", kindLabel, sc && sc.regime && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", /* @__PURE__ */ React.createElement("span", { className: sc.regime.correct ? "vg-up" : "vg-down" }, sc.regime.correct ? "forecast held \u2713" : "forecast missed \u2717")))), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", disabled: busy === `del${s.id}`, onClick: () => onDelete(s.id) }, busy === `del${s.id}` ? "\u2026" : "delete")), /* @__PURE__ */ React.createElement(TradesPanel, { snap: s, thoughts, onThought: setThought }), /* @__PURE__ */ React.createElement("details", { className: "vg-jr-forecast" }, /* @__PURE__ */ React.createElement("summary", { className: "vg-note", style: { cursor: "pointer", fontWeight: 600, marginTop: 14 } }, "Forecast vs. actual", sc && sc.level_accuracy != null ? ` \xB7 levels ${pct5(sc.level_accuracy)}` : "", sc && sc.regime ? ` \xB7 ${sc.regime.outcome} (${sc.regime.moved_pct}%)` : ""), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tiles", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tile" }, /* @__PURE__ */ React.createElement("h4", null, "The forecast"), f.plan ? /* @__PURE__ */ React.createElement("div", { className: "big" }, f.gamma, " gamma") : /* @__PURE__ */ React.createElement("div", { className: "big", style: { fontWeight: 400 } }, "No forecast frozen"), f.plan && /* @__PURE__ */ React.createElement("div", { className: "sub" }, f.plan), f.spot != null && /* @__PURE__ */ React.createElement("div", { className: "sub" }, "spot at forecast: ", Math.round(f.spot), f.gamma_flip != null ? ` \xB7 flip ${Math.round(f.gamma_flip)}` : "")), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tile" }, /* @__PURE__ */ React.createElement("h4", null, "Actual"), sc ? /* @__PURE__ */ React.createElement("div", { className: "sub" }, "price ", sc.price_low, "\u2013", sc.price_high, " (last ", sc.price_last, ")", sc.regime && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 ", sc.regime.outcome, " (", sc.regime.moved_pct, "% move)"), sc.level_accuracy != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 levels ", pct5(sc.level_accuracy))) : /* @__PURE__ */ React.createElement("div", { className: "sub" }, "Not scored yet \u2014 scores against today's session once bars print."))), (f.levels || []).length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-jr-tile", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("h4", null, "Levels \u2014 forecast vs. actual"), /* @__PURE__ */ React.createElement(LevelTable, { forecast: f, scorecard: sc }))), /* @__PURE__ */ React.createElement("div", { className: "vg-jr-form", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("h4", { style: { margin: 0 } }, "My journal \u2014 the day overall"), ENTRY_FIELDS.map(([k, label, ph]) => /* @__PURE__ */ React.createElement("div", { key: k, className: "vg-jr-field" }, /* @__PURE__ */ React.createElement("label", null, label), k === "notes" ? /* @__PURE__ */ React.createElement(
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
    ))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, marginTop: 4, alignItems: "center" } }, /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", disabled: busy === `entry${s.id}` || !dirty, onClick: save }, busy === `entry${s.id}` ? "Saving\u2026" : "Save"), dirty && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, "unsaved changes"))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 14 } }, s.image_path ? /* @__PURE__ */ React.createElement("div", { className: "vg-jr-chart" }, /* @__PURE__ */ React.createElement(
      "img",
      {
        src: journalImageUrl(s.id),
        alt: "reference chart",
        onError: (e) => {
          e.target.style.display = "none";
        }
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "space-between", marginTop: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, "reference chart \xB7 never analyzed"), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => fileRef.current && fileRef.current.click() }, "replace")), /* @__PURE__ */ React.createElement(
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
        style: { padding: "12px" },
        onDragOver: (e) => {
          e.preventDefault();
          setDrag(true);
        },
        onDragLeave: () => setDrag(false),
        onDrop,
        onClick: () => fileRef.current && fileRef.current.click()
      },
      /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 13 } }, busy === "upload" ? "Saving\u2026" : "\u{1F4CE} Attach a reference chart \u2014 drop, paste (\u2318V), or click (never analyzed)"),
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
    )));
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
      return /* @__PURE__ */ React.createElement("tr", { key: lv.key, className: muted ? "muted" : "" }, /* @__PURE__ */ React.createElement("td", { className: "lvl-price" }, /* @__PURE__ */ React.createElement("b", null, Math.round(lv.price)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 4, fontSize: 12 } }, lv.key)), /* @__PURE__ */ React.createElement("td", null, lv.role, lv.confluence ? " \u2726" : "", lv.durable ? " \u2605" : ""), /* @__PURE__ */ React.createElement("td", { className: "lvl-expect" }, lv.expect || lv.label || "\u2014"), /* @__PURE__ */ React.createElement("td", null, v ? /* @__PURE__ */ React.createElement(
        "span",
        {
          className: cls("vg-badge", VERDICT_TONE[v] || "plain"),
          style: { minWidth: 52, textAlign: "center", display: "inline-block" }
        },
        VERDICT_LABEL[v] || v
      ) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: "lvl-actual vg-note" }, actualForLevel(lv, v, scorecard)));
    }))));
  }
  var STATUS_TONE = {
    closed: "plain",
    open: "warn",
    expired_worthless: "bad",
    expired_settled: "good",
    expired_unpriced: "warn"
  };
  var STATUS_LABEL = {
    closed: "CLOSED",
    open: "OPEN",
    expired_worthless: "EXPIRED \xB7 $0",
    expired_settled: "EXPIRED ITM",
    expired_unpriced: "EXPIRED"
  };
  var money6 = (n) => n == null ? "\u2014" : `${n >= 0 ? "+" : "\u2212"}$${Math.abs(n).toLocaleString(void 0, { maximumFractionDigits: 0 })}`;
  var fmtLvl = (v) => v == null ? "\u2014" : Number(v).toFixed(v >= 100 ? 0 : 2);
  function TradesPanel({ snap, thoughts, onThought }) {
    const [data, setData] = useState16(null);
    const [busy, setBusy] = useState16(false);
    const [open, setOpen] = useState16(null);
    const [batch, setBatch] = useState16(null);
    const [tk, setTk] = useState16("all");
    const [daySyn, setDaySyn] = useState16(null);
    const day = String(snap.created_at || "").slice(0, 10);
    const load = async () => {
      setBusy(true);
      const v = await getSessionActivity(day, void 0);
      setBusy(false);
      setData(v && v.available ? v : { empty: true });
    };
    const analyzeToday = async () => {
      const trades = data && data.trades || [];
      const completed = trades.map((t, i) => ({ t, i })).filter(({ t }) => t.status !== "open");
      if (!completed.length) return;
      let analyzed = /* @__PURE__ */ new Set();
      try {
        const ak = await getAnalyzedKeys(day);
        if (ak && ak.available) analyzed = new Set(ak.keys || []);
      } catch (e) {
      }
      const targets = completed.filter(({ t, i }) => !analyzed.has(`${t.opened_at || i}|${t.label}`));
      if (!targets.length) {
        await synthesizeDay();
        return;
      }
      setBatch({ done: 0, total: targets.length, running: true });
      let done = 0;
      for (const { t, i } of targets) {
        const key = `${t.account || ""}|${t.opened_at || i}|${t.label}`;
        const operator = operatorFor(t, thoughts && thoughts[key] || "");
        try {
          await analyzeTradeOnce(day, i, t.ticker || "SPX", operator);
        } catch (e) {
        }
        done += 1;
        setBatch({ done, total: targets.length, running: done < targets.length });
      }
      setBatch({ done, total: targets.length, running: false });
      await load();
      await synthesizeDay();
    };
    const synthesizeDay = async () => {
      setDaySyn({ loading: true, text: "" });
      try {
        const res = await getDayReviewBundle(day, "SPX");
        if (!res || !res.available || !res.prompt) {
          setDaySyn({ error: res && res.note || "no completed trades to synthesize" });
          return;
        }
        const { text, data: sdata, error } = await collectTurn(res.prompt, `day-${day}`, {
          onToken: (t) => setDaySyn({ loading: true, text: t })
        });
        if (error && !text) {
          setDaySyn({ error });
          return;
        }
        setDaySyn({ text, data: sdata });
        if (text.trim()) {
          const b = res.bundle || {};
          saveDayReview({
            day,
            underlying: "SPX",
            narrative: text,
            metrics: { net_pnl: b.net_pnl, counts: b.counts, metrics: b.metrics }
          }).then(() => loadDayReviews()).catch(() => {
          });
        }
      } catch (e) {
        setDaySyn({ error: String(e && e.message || e) });
      }
    };
    const [synHist, setSynHist] = useState16([]);
    const [synPick, setSynPick] = useState16(null);
    const loadDayReviews = async () => {
      try {
        const r = await getDayReviews(day);
        setSynHist(r && r.available && r.reviews || []);
      } catch (e) {
      }
    };
    useEffect13(() => {
      setSynPick(null);
      setDaySyn(null);
      loadDayReviews();
    }, [day]);
    useEffect13(() => {
      setData(null);
      setOpen(null);
      setTk("all");
      let live = true;
      (async () => {
        setBusy(true);
        const v = await getSessionActivity(day, void 0);
        if (live) {
          setData(v && v.available ? v : { empty: true });
          setBusy(false);
        }
      })();
      return () => {
        live = false;
      };
    }, [snap.id, day]);
    if (!data) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, "My trades \u2014 what I actually did"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 4, fontSize: 13 } }, "Every decision reconstructed from your broker fills \u2014 pinned to the underlying's price at the minute you submitted it, correlated to the levels you forecast, expiries settled against the print.")), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, busy ? "Loading your trades\u2026" : "")));
    }
    if (data.empty) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("p", { className: "vg-note" }, "No trades on ", day, "."));
    }
    const s = data.summary || {};
    const tickers = data.tickers || [];
    const rows = (data.trades || []).map((t, i) => ({ t, i })).filter(({ t }) => tk === "all" || t.ticker === tk);
    const allLevels = [
      ...(data.forecast_levels || []).map((z) => ({ ...z, source: "confluence" })),
      ...(data.gex_anchors || []).map((a) => ({ price: a.price, role: a.label, kinds: [a.label], source: "gex" })),
      ...(data.durable_levels || []).map((d) => ({ price: d.price, role: d.label, kinds: [d.label], source: "durable" }))
    ].sort((a, b) => (b.price || 0) - (a.price || 0));
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, "My trades \u2014 ", rows.length, tk !== "all" ? ` of ${s.trades}` : "", " decisions", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 13, fontWeight: 400 } }, " ", "\xB7 click a trade to correlate it to the plan")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 6, alignItems: "center" } }, tickers.length > 1 && /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "vg-ticker-filter",
        value: tk,
        onChange: (e) => setTk(e.target.value),
        title: "Filter by ticker"
      },
      /* @__PURE__ */ React.createElement("option", { value: "all" }, "All tickers"),
      tickers.map((x) => /* @__PURE__ */ React.createElement("option", { key: x, value: x }, x))
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm vg-btn-primary",
        disabled: busy || batch && batch.running || daySyn && daySyn.loading,
        onClick: analyzeToday,
        title: "Desk-review every closed trade, then a book-level day synthesis (direction / time / allocation)"
      },
      batch && batch.running ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"), " Analyzing ", batch.done, "/", batch.total, "\u2026") : daySyn && daySyn.loading ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"), " Day synthesis\u2026") : "Analyze today"
    ), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: load, disabled: busy }, busy ? "\u2026" : "\u27F3"))), batch && !batch.running && batch.total > 0 && !daySyn && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "4px 0 0", fontSize: 12, color: "var(--vg-up)" } }, "\u2713 analyzed ", batch.total, " trade", batch.total === 1 ? "" : "s", " (already-analyzed ones skipped)"), (() => {
      const live = daySyn && (daySyn.loading || daySyn.data || daySyn.text || daySyn.error);
      const stored = !live && (synPick || synHist[0]);
      if (!live && !stored) return null;
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-day-syn", style: { margin: "10px 0 0" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", flexWrap: "wrap", gap: 8 } }, /* @__PURE__ */ React.createElement("h4", { style: { margin: 0, fontSize: 14, letterSpacing: "0.03em" } }, "Day synthesis ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "\u2014 the book, not the trades")), live && daySyn.loading && /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"), stored && /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 8, alignItems: "baseline" } }, synHist.length > 1 && /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "vg-rp-runpick",
          value: (synPick || synHist[0]).id,
          onChange: (e) => setSynPick(synHist.find((h) => String(h.id) === e.target.value) || null)
        },
        synHist.map((h, i) => /* @__PURE__ */ React.createElement("option", { key: h.id, value: h.id }, String(h.generated_at || "").slice(11, 16), i === 0 ? " (latest)" : ""))
      ), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: "var(--vg-text-xs)" } }, "saved ", String(stored.generated_at || "").slice(0, 16).replace("T", " ")))), live ? daySyn.error ? /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 6 } }, daySyn.error) : daySyn.data || daySyn.text ? /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(MiraRender, { data: daySyn.data, text: daySyn.text })) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 6 } }, "Reading the day\u2026") : /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(MiraRender, { data: parseMira(stored.narrative), text: stored.narrative })));
    })(), /* @__PURE__ */ React.createElement(ToneCompareCard, { marketOpen: false, day: s.created_at ? String(s.created_at).slice(0, 10) : void 0 }), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 20, margin: "10px 0", flexWrap: "wrap", fontSize: 14 } }, /* @__PURE__ */ React.createElement("span", null, "P&L ", /* @__PURE__ */ React.createElement("b", { className: s.realized >= 0 ? "vg-up" : "vg-down" }, money6(s.realized))), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "fills ", money6(s.realized_from_fills)), s.expired > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "expiry ", money6(s.realized_from_expiry), " \xB7 ", s.expired_worthless, " worthless ", /* @__PURE__ */ React.createElement("b", { className: "vg-down" }, money6(s.expired_loss))), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, s.winners, "W / ", s.losers, "L"), s.win_rate != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "win rate ", /* @__PURE__ */ React.createElement("b", null, Math.round(s.win_rate * 100), "%")), s.profit_factor != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "profit factor", " ", /* @__PURE__ */ React.createElement("b", { className: s.profit_factor >= 1 ? "vg-up" : "vg-down" }, s.profit_factor.toFixed(2))), s.settle_price && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "SPX settled ", fmtLvl(s.settle_price)), s.level_discipline != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "entered at level ", /* @__PURE__ */ React.createElement("b", null, Math.round(s.level_discipline * 100), "%")), s.exit_discipline != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "exited at level ", /* @__PURE__ */ React.createElement("b", null, Math.round(s.exit_discipline * 100), "%")), s.level_to_level > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, /* @__PURE__ */ React.createElement("b", null, s.level_to_level), " level-to-level")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, rows.map(({ t, i }) => {
      const key = `${t.account || ""}|${t.opened_at || i}|${t.label}`;
      return /* @__PURE__ */ React.createElement(
        TradeCard,
        {
          key,
          t,
          tkey: key,
          tradeIndex: i,
          day,
          underlying: t.ticker || "SPX",
          expanded: open === key,
          onToggle: () => setOpen(open === key ? null : key),
          thought: thoughts && thoughts[key] || "",
          onThought: (v) => onThought(key, v),
          allLevels
        }
      );
    })), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { fontSize: 12, marginTop: 8 } }, "Price is the 1-minute print at submission, per the trade's own ticker. Tag the level you were trading \u2014 the broker says WHAT you did; only you can say WHY. Saves with the entry."));
  }
  var REC_TONE = { improving: "good", worse: "bad", flat: "plain", new: "plain" };
  var SCORE_TONE = (s) => s >= 70 ? "good" : s >= 45 ? "warn" : "bad";
  var RUBRIC_LABELS = {
    entry_discipline: "Entry discipline",
    exit_discipline: "Exit discipline",
    risk_sizing: "Risk & sizing",
    plan_adherence: "Plan adherence",
    emotional_control: "Emotional control"
  };
  function AnalysisDetail({ h }) {
    const recs = h.recommendations && h.recommendations.length ? h.recommendations : Object.entries(h.scores || {}).map(([dim, score]) => ({
      dimension: dim,
      label: RUBRIC_LABELS[dim] || dim,
      score,
      status: "new",
      delta: null
    }));
    return /* @__PURE__ */ React.createElement("div", { className: "vg-ja-detail" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, "Scorecard"), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 13 } }, h.trades, " trades \xB7 net ", /* @__PURE__ */ React.createElement("b", { className: h.net_pnl >= 0 ? "vg-up" : "vg-down" }, money6(h.net_pnl)), " \xB7 rubric v", h.rubric_version)), /* @__PURE__ */ React.createElement("div", { className: "vg-scores" }, recs.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.dimension, className: "vg-score" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, r.label), /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 6, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("b", { className: cls("vg-score-n", `vg-${SCORE_TONE(r.score)}`) }, r.score), r.delta != null ? /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", REC_TONE[r.status]), style: { fontSize: 12 } }, r.delta > 0 ? "\u25B2" : r.delta < 0 ? "\u25BC" : "\u2014", Math.abs(r.delta), " \xB7 ", r.status) : /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { fontSize: 12 } }, "baseline"))), /* @__PURE__ */ React.createElement("div", { className: "vg-score-track" }, /* @__PURE__ */ React.createElement("div", { className: cls("vg-score-fill", `bg-${SCORE_TONE(r.score)}`), style: { width: `${r.score}%` } }))))), (h.patterns || []).length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 16 } }, "Recurring patterns"), /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("tbody", null, h.patterns.map((p, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", { style: { width: 26, textAlign: "right", color: "var(--vg-down)", fontWeight: 700 } }, p.count, "\xD7"), /* @__PURE__ */ React.createElement("td", null, p.pattern, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, " \xB7 ", (p.cites || []).length, " trades"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 16 } }, "SWOT & read"), h.swot ? /* @__PURE__ */ React.createElement(SwotRender, { swot: h.swot }) : /* @__PURE__ */ React.createElement("div", { className: "vg-dna-read", style: { marginTop: 8 } }, h.narrative || "(no narrative saved)"));
  }
  function JournalAnalysisPanel({ sym }) {
    const [win, setWin] = useState16(() => {
      const to = todayISO2();
      const from = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
      return { from, to, period: "weekly" };
    });
    const [bundle, setBundle] = useState16(null);
    const [read, setRead] = useState16(null);
    const [saved, setSaved] = useState16(false);
    const [hist, setHist] = useState16(null);
    const abortRef = useRef5(null);
    const [openId, setOpenId] = useState16(null);
    const toggleStored = (h) => setOpenId((cur) => cur === h.id ? null : h.id);
    const loadHist = async () => {
      const h = await getJournalAnalyses(sym);
      const list = h && h.available ? h.analyses || [] : [];
      setHist(list);
      return list;
    };
    useEffect13(() => {
      setBundle(null);
      setRead(null);
      setSaved(false);
      setOpenId(null);
      loadHist();
    }, [sym]);
    const generate = async () => {
      setRead({ loading: true });
      setSaved(false);
      const res = await getJournalAnalysisBundle(win.from, win.to, sym);
      if (!res || !res.available || !res.bundle) {
        setRead({ error: res && res.note || "couldn't build the bundle" });
        return;
      }
      setBundle(res.bundle);
      setRead({ text: "" });
      const { text, data, error } = await collectTurn(res.prompt, `journal-${win.from}-${win.to}`, {
        onToken: (t) => setRead({ text: t }),
        setAbort: (fn) => {
          abortRef.current = fn;
        }
      });
      if (error && !text) {
        setRead({ error });
        return;
      }
      setRead({ text, data, mode: data ? "structured" : "prose" });
      if (text.trim()) {
        const b2 = res.bundle;
        const swotSec = data && Array.isArray(data.sections) ? data.sections.find((s) => s && s.kind === "swot") : null;
        saveJournalAnalysis({
          period: win.period,
          window_from: win.from,
          window_to: win.to,
          underlying: sym,
          rubric_version: b2.rubric_version,
          trades: b2.trades,
          net_pnl: b2.net_pnl,
          scores: b2.scores,
          patterns: b2.patterns,
          recommendations: b2.recommendations,
          swot: swotSec && swotSec.swot || null,
          narrative: text
        }).then((r) => {
          setSaved(true);
          loadHist().then(() => {
            setRead(null);
            setBundle(null);
            if (r && r.id) setOpenId(r.id);
          });
        }).catch((e) => {
          setRead((cur) => ({
            ...cur || {},
            text,
            error: `analysis rendered but SAVE FAILED: ${String(e && e.message || e)}`
          }));
        });
      }
    };
    useEffect13(() => () => {
      if (abortRef.current) abortRef.current();
    }, []);
    const b = bundle;
    const busy = read && read.loading;
    const streaming = read && read.text != null && !saved && !read.error;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-ja vg-loadhost" }, (busy || streaming) && /* @__PURE__ */ React.createElement(LoadBar, null), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "flex-end", flexWrap: "wrap", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 12, alignItems: "flex-end", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field" }, /* @__PURE__ */ React.createElement("label", null, "From"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        value: win.from,
        max: win.to,
        onChange: (e) => setWin({ ...win, from: e.target.value })
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field" }, /* @__PURE__ */ React.createElement("label", null, "To"), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "date",
        value: win.to,
        min: win.from,
        max: todayISO2(),
        onChange: (e) => setWin({ ...win, to: e.target.value })
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field" }, /* @__PURE__ */ React.createElement("label", null, "Tag this run"), /* @__PURE__ */ React.createElement("select", { value: win.period, onChange: (e) => setWin({ ...win, period: e.target.value }) }, /* @__PURE__ */ React.createElement("option", { value: "daily" }, "daily"), /* @__PURE__ */ React.createElement("option", { value: "weekly" }, "weekly"), /* @__PURE__ */ React.createElement("option", { value: "monthly" }, "monthly"), /* @__PURE__ */ React.createElement("option", { value: "on-demand" }, "on-demand"))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 4 } }, [["1D", 0], ["7D", 6], ["30D", 29]].map(([lab, back]) => /* @__PURE__ */ React.createElement("button", { key: lab, className: "vg-btn-sm", onClick: () => setWin({
      ...win,
      from: new Date(Date.now() - back * 864e5).toISOString().slice(0, 10),
      to: todayISO2(),
      period: back === 0 ? "daily" : back === 6 ? "weekly" : "monthly"
    }) }, lab)))), /* @__PURE__ */ React.createElement("button", { className: "vg-btn vg-btn-primary", disabled: busy || streaming, onClick: generate }, busy || streaming ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"), " Analyzing\u2026") : "Generate analysis")), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, fontSize: 13 } }, "Scores the window against a rubric, aggregates every recorded trade review into a SWOT, and builds on the last analysis so your self-knowledge compounds. Analyze trades first (Days \u2192 Analyze today).")), b && read && /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, "Scorecard \xB7 ", b.window_from, " \u2192 ", b.window_to), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 13 } }, b.trades, " trades", b.analyzed != null ? ` \xB7 ${b.analyzed} reviewed` : "", " \xB7 net ", /* @__PURE__ */ React.createElement("b", { className: b.net_pnl >= 0 ? "vg-up" : "vg-down" }, money6(b.net_pnl)), b.overall && b.overall.win_rate != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 win rate ", /* @__PURE__ */ React.createElement("b", null, Math.round(b.overall.win_rate * 100), "%")), b.overall && b.overall.profit_factor != null && /* @__PURE__ */ React.createElement(React.Fragment, null, " \xB7 PF ", /* @__PURE__ */ React.createElement("b", { className: b.overall.profit_factor >= 1 ? "vg-up" : "vg-down" }, b.overall.profit_factor.toFixed(2))), " ", "\xB7 rubric v", b.rubric_version)), /* @__PURE__ */ React.createElement("div", { className: "vg-scores" }, b.recommendations.map((r) => /* @__PURE__ */ React.createElement("div", { key: r.dimension, className: "vg-score" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, r.label), /* @__PURE__ */ React.createElement("span", { className: "vg-row", style: { gap: 6, alignItems: "baseline" } }, /* @__PURE__ */ React.createElement("b", { className: cls("vg-score-n", `vg-${SCORE_TONE(r.score)}`) }, r.score), r.delta != null && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", REC_TONE[r.status]), style: { fontSize: 12 } }, r.delta > 0 ? "\u25B2" : r.delta < 0 ? "\u25BC" : "\u2014", Math.abs(r.delta), " \xB7 ", r.status), r.delta == null && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { fontSize: 12 } }, "baseline"))), /* @__PURE__ */ React.createElement("div", { className: "vg-score-track" }, /* @__PURE__ */ React.createElement("div", { className: cls("vg-score-fill", `bg-${SCORE_TONE(r.score)}`), style: { width: `${r.score}%` } }))))), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 16 } }, "Recurring patterns"), /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("tbody", null, b.patterns.map((p, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", { style: { width: 26, textAlign: "right", color: "var(--vg-down)", fontWeight: 700 } }, p.count, "\xD7"), /* @__PURE__ */ React.createElement("td", null, p.pattern, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 } }, " \xB7 ", p.cites.length, " trades"))))))), read && (read.text != null || read.error || read.loading) && /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, "SWOT & read ", saved && /* @__PURE__ */ React.createElement("span", { className: "vg-up", style: { fontSize: 12 } }, "\u2713 saved")), read.mode === "prose" && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontSize: 12 }, title: "the model's output wasn't structured JSON \u2014 showing the prose read" }, "prose fallback")), read.loading && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8 } }, "Aggregating your reviews and scoring the window\u2026"), read.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, color: "var(--vg-down)" } }, read.error), read.text != null && read.mode == null && !read.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"), " Mira is writing the desk review\u2026"), (read.data || read.text) && /* @__PURE__ */ React.createElement(MiraRender, { data: read.data, text: read.text })), hist && hist.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Analyses \xB7 click a row to open \xB7 knowledge compounds"), /* @__PURE__ */ React.createElement("div", { className: "vg-ja-list", style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-ja-hrow vg-ja-head vg-note" }, /* @__PURE__ */ React.createElement("span", { className: "c-win" }, "window"), /* @__PURE__ */ React.createElement("span", { className: "c-tag" }, "tag"), /* @__PURE__ */ React.createElement("span", { className: "c-sc" }, "entry"), /* @__PURE__ */ React.createElement("span", { className: "c-sc" }, "exit"), /* @__PURE__ */ React.createElement("span", { className: "c-sc" }, "risk"), /* @__PURE__ */ React.createElement("span", { className: "c-sc" }, "plan"), /* @__PURE__ */ React.createElement("span", { className: "c-net" }, "net")), hist.map((h) => {
      const s = h.scores || {};
      const isOpen = openId === h.id;
      return /* @__PURE__ */ React.createElement("div", { key: h.id, className: "vg-ja-item" }, /* @__PURE__ */ React.createElement(
        "div",
        {
          className: cls("vg-ja-hrow", "vg-ja-row", isOpen && "open"),
          onClick: () => toggleStored(h),
          title: isOpen ? "Collapse" : "Expand this analysis"
        },
        /* @__PURE__ */ React.createElement("span", { className: "c-win" }, isOpen ? "\u25BE " : "\u25B8 ", h.window_from, " \u2192 ", h.window_to),
        /* @__PURE__ */ React.createElement("span", { className: "c-tag" }, /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", style: { fontSize: 12 } }, h.period)),
        /* @__PURE__ */ React.createElement("span", { className: cls("c-sc", `vg-${SCORE_TONE(s.entry_discipline || 0)}`) }, s.entry_discipline ?? "\u2014"),
        /* @__PURE__ */ React.createElement("span", { className: cls("c-sc", `vg-${SCORE_TONE(s.exit_discipline || 0)}`) }, s.exit_discipline ?? "\u2014"),
        /* @__PURE__ */ React.createElement("span", { className: cls("c-sc", `vg-${SCORE_TONE(s.risk_sizing || 0)}`) }, s.risk_sizing ?? "\u2014"),
        /* @__PURE__ */ React.createElement("span", { className: cls("c-sc", `vg-${SCORE_TONE(s.plan_adherence || 0)}`) }, s.plan_adherence ?? "\u2014"),
        /* @__PURE__ */ React.createElement("span", { className: cls("c-net", h.net_pnl >= 0 ? "vg-up" : "vg-down") }, money6(h.net_pnl))
      ), isOpen && /* @__PURE__ */ React.createElement(AnalysisDetail, { h }));
    }))));
  }
  var THOUGHT_RE = /^@([\d.]*)(?:\/([\d.]*))?(?:~([^|]*))?\|/;
  function operatorFor(t, thought) {
    const m = (thought || "").match(THOUGHT_RE) || [];
    const why = (thought || "").replace(THOUGHT_RE, "");
    const corr = t.correlation, exitCorr = t.exit_correlation;
    const nearest3 = corr && corr.nearest, exitNearest = exitCorr && exitCorr.nearest;
    const autoEntry = corr && corr.at_level && nearest3 ? String(nearest3.level) : null;
    const autoExit = exitCorr && exitCorr.at_level && exitNearest ? String(exitNearest.level) : null;
    return {
      why,
      entryTag: m[1] || autoEntry,
      exitTag: m[2] || autoExit,
      structTag: m[3] || null,
      entryTagAuto: !m[1] && !!autoEntry,
      exitTagAuto: !m[2] && !!autoExit
    };
  }
  function TradeCard({ t, tkey, tradeIndex, day, underlying, expanded, onToggle, thought, onThought, allLevels }) {
    const corr = t.correlation;
    const nearest3 = corr && corr.nearest;
    const exitCorr = t.exit_correlation;
    const exitNearest = exitCorr && exitCorr.nearest;
    const long = String(t.strategy).includes("call");
    const m = thought.match(THOUGHT_RE) || [];
    const op = operatorFor(t, thought);
    const why = op.why;
    const tag = op.entryTag, exitTag = op.exitTag, structTag = op.structTag;
    const tagAuto = op.entryTagAuto, exitTagAuto = op.exitTagAuto;
    const rawTag = m[1] || null, rawExit = m[2] || null, rawStruct = m[3] || null;
    const encode = (e, x, s, w) => {
      if (!e && !x && !s) return w;
      return `@${e || ""}${x ? `/${x}` : ""}${s ? `~${s}` : ""}|${w}`;
    };
    const setTag = (level) => onThought(encode(level, rawExit, rawStruct, why));
    const setExitTag = (level) => onThought(encode(rawTag, level, rawStruct, why));
    const setStructTag = (s) => onThought(encode(rawTag, rawExit, s, why));
    const setWhy = (v) => onThought(encode(rawTag, rawExit, rawStruct, v));
    const structQ = useLive(
      () => expanded ? getEntryStructure(day, tradeIndex, underlying) : Promise.resolve(null),
      null,
      [expanded, day, tradeIndex]
    );
    const structCtx = structQ.data && structQ.data.available ? structQ.data.structure : null;
    return /* @__PURE__ */ React.createElement("div", { className: cls("vg-trade", expanded && "open") }, /* @__PURE__ */ React.createElement("div", { className: "vg-trade-row", onClick: onToggle }, /* @__PURE__ */ React.createElement("span", { className: "vg-trade-time" }, t.opened_et || (t.opened_at || "").slice(11, 16) || "\u2014"), /* @__PURE__ */ React.createElement("span", { className: "vg-trade-name" }, t.ticker && /* @__PURE__ */ React.createElement("span", { className: "vg-badge accent vg-ticker-badge", title: `ticker: ${t.ticker}` }, t.ticker), /* @__PURE__ */ React.createElement("b", { className: long ? "vg-up" : "vg-down" }, t.label), t.account_label && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-badge plain",
        style: { marginLeft: 6, fontSize: 12 },
        title: `account: ${t.account_label}`
      },
      t.account_label
    )), /* @__PURE__ */ React.createElement("span", { className: "vg-trade-spx" }, t.ticker || "SPX", " ", fmtLvl(t.spot_at_entry)), /* @__PURE__ */ React.createElement("span", null, nearest3 ? /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", corr.at_level ? "good" : "plain"),
        title: `entry: ${nearest3.role || ""} ${(nearest3.kinds || []).join(" + ")}`
      },
      corr.at_level ? "\u2713 " : "",
      fmtLvl(nearest3.level)
    ) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014"), exitNearest && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { margin: "0 3px" } }, "\u2192"), exitNearest && /* @__PURE__ */ React.createElement(
      "span",
      {
        className: cls("vg-badge", t.exit_correlation.at_level ? "good" : "plain"),
        title: `exit: ${exitNearest.role || ""} ${(exitNearest.kinds || []).join(" + ")}`
      },
      t.exit_correlation.at_level ? "\u2713 " : "",
      fmtLvl(exitNearest.level)
    )), t.status === "open" ? /* @__PURE__ */ React.createElement("span", { className: "vg-trade-pnl vg-note", title: "open position \u2014 no realized P&L yet" }, "open") : /* @__PURE__ */ React.createElement("span", { className: cls("vg-trade-pnl", t.realized >= 0 ? "vg-up" : "vg-down") }, money6(t.realized)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", STATUS_TONE[t.status] || "plain") }, STATUS_LABEL[t.status] || t.status), /* @__PURE__ */ React.createElement("span", { className: "vg-trade-caret" }, expanded ? "\u25BE" : "\u25B8")), expanded && /* @__PURE__ */ React.createElement("div", { className: "vg-trade-detail" }, /* @__PURE__ */ React.createElement("div", { className: "vg-trade-grid" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "The order"), /* @__PURE__ */ React.createElement("table", { className: "vg-mini" }, /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "strategy"), /* @__PURE__ */ React.createElement("td", null, t.strategy)), t.legs.map((l, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, l.side), /* @__PURE__ */ React.createElement("td", null, l.qty, " \xD7 ", (l.symbol || "").replace(/^\S+\s\S+\s/, ""), " @ ", l.price))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "opened"), /* @__PURE__ */ React.createElement("td", null, t.opened_et ? `${t.opened_et} ET` : "\u2014")), t.closed_at && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "closed"), /* @__PURE__ */ React.createElement("td", null, t.closed_et ? `${t.closed_et} ET` : "\u2014")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "cost"), /* @__PURE__ */ React.createElement("td", null, money6(t.cost))), t.proceeds ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "proceeds"), /* @__PURE__ */ React.createElement("td", null, money6(t.proceeds))) : null, t.settlement != null && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "settlement"), /* @__PURE__ */ React.createElement("td", null, money6(t.settlement), " @ SPX ", fmtLvl(t.settle_price))), t.status === "open" ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "status")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "open"), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\xB7 ", money6(t.cost_basis), " in, no realized P&L yet"))) : /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "realized")), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", { className: t.realized >= 0 ? "vg-up" : "vg-down" }, money6(t.realized)))))), /* @__PURE__ */ React.createElement(FillLadder, { fills: t.fills, scale: t.scale })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "The arc"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, margin: "2px 0 10px", fontVariantNumeric: "tabular-nums" } }, "in ", /* @__PURE__ */ React.createElement("b", null, fmtLvl(t.spot_at_entry)), nearest3 && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", corr.at_level ? "good" : "plain"), style: { marginLeft: 4 } }, fmtLvl(nearest3.level)), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { margin: "0 6px" } }, "\u2192"), "out ", /* @__PURE__ */ React.createElement("b", null, fmtLvl(t.spot_at_exit)), exitNearest && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", exitCorr.at_level ? "good" : "plain"), style: { marginLeft: 4 } }, fmtLvl(exitNearest.level)), t.spot_at_entry != null && t.spot_at_exit != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " \xB7 ", t.spot_at_exit - t.spot_at_entry >= 0 ? "+" : "", (t.spot_at_exit - t.spot_at_entry).toFixed(1), "pt ", t.ticker || "SPX", String(t.status).startsWith("expired") ? " (settlement)" : "")), /* @__PURE__ */ React.createElement(CorrTable, { title: `Entry \xB7 ${t.ticker || "SPX"} ${fmtLvl(t.spot_at_entry)}`, corr, openSpace: "entry was in open space" }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(
      CorrTable,
      {
        title: `Exit \xB7 ${t.ticker || "SPX"} ${fmtLvl(t.spot_at_exit)}${String(t.status).startsWith("expired") ? " (settled)" : ""}`,
        corr: exitCorr,
        openSpace: "exit was in open space"
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, marginTop: 10, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field", style: { flex: 1, minWidth: 150 } }, /* @__PURE__ */ React.createElement("label", null, "Level I entered on ", tagAuto && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "\xB7 auto")), /* @__PURE__ */ React.createElement("select", { value: tag || "", onChange: (e) => setTag(e.target.value || null) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 none / open space \u2014"), allLevels.map((l, i) => /* @__PURE__ */ React.createElement("option", { key: i, value: l.price }, fmtLvl(l.price), " \xB7 ", l.role, (l.kinds || []).length ? ` (${l.kinds.join(" + ")})` : "")))), /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field", style: { flex: 1, minWidth: 150 } }, /* @__PURE__ */ React.createElement("label", null, "Level I exited on ", exitTagAuto && /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "\xB7 auto")), /* @__PURE__ */ React.createElement("select", { value: exitTag || "", onChange: (e) => setExitTag(e.target.value || null) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "\u2014 none / open space \u2014"), allLevels.map((l, i) => /* @__PURE__ */ React.createElement("option", { key: i, value: l.price }, fmtLvl(l.price), " \xB7 ", l.role, (l.kinds || []).length ? ` (${l.kinds.join(" + ")})` : "")))), /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field", style: { flex: 1, minWidth: 190 } }, /* @__PURE__ */ React.createElement("label", null, "Structure I traded off", /* @__PURE__ */ React.createElement(
      "span",
      {
        className: "vg-note",
        style: { fontWeight: 400 },
        title: "FVGs adjacent to your fill (per timeframe) + recent hourly liquidity sweeps, computed as of your entry. Your pick goes to Mira as YOUR claimed reasoning \u2014 she evaluates the trade against it."
      },
      " ",
      "\xB7 FVG / sweep"
    )), /* @__PURE__ */ React.createElement(
      "select",
      {
        value: structTag || "",
        onChange: (e) => setStructTag(e.target.value || null),
        disabled: !structCtx && !structTag
      },
      /* @__PURE__ */ React.createElement("option", { value: "" }, structQ.loading ? "reading structure\u2026" : "\u2014 none \u2014"),
      structTag && structCtx == null && /* @__PURE__ */ React.createElement("option", { value: structTag }, structTag),
      structCtx && ["1m", "5m", "15m"].map((tf) => {
        const rows = (structCtx.fvgs_at_entry || {})[tf] || [];
        return rows.length ? /* @__PURE__ */ React.createElement("optgroup", { key: tf, label: `${tf} gaps` }, rows.map((g, i) => {
          const v = `${tf} ${g.side} FVG ${g.lo}-${g.hi}`;
          return /* @__PURE__ */ React.createElement("option", { key: i, value: v }, g.side, " ", g.lo, "\u2013", g.hi, g.inside ? " \xB7 entry inside" : ` \xB7 ${g.dist_pt}pt away`);
        })) : null;
      }),
      structCtx && (structCtx.htf_sweeps || []).length > 0 && /* @__PURE__ */ React.createElement("optgroup", { label: "HTF liquidity sweeps" }, structCtx.htf_sweeps.map((s, i) => {
        const v = `hourly ${s.side} sweep at ${s.level} (${s.hours_before_entry}h before entry)`;
        return /* @__PURE__ */ React.createElement("option", { key: i, value: v }, s.side, " ", s.level, " \xB7 ", s.hours_before_entry, "h before entry");
      }))
    ))))), /* @__PURE__ */ React.createElement("div", { className: "vg-trade-field", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("label", null, "My thinking \u2014 why did I take this trade?"), /* @__PURE__ */ React.createElement(
      "textarea",
      {
        rows: 2,
        value: why,
        onChange: (e) => setWhy(e.target.value),
        placeholder: "the read, the trigger, what I was expecting \u2014 the WHY the broker can't record"
      }
    )), /* @__PURE__ */ React.createElement(
      AnalyzeTrade,
      {
        day,
        tradeIndex,
        underlying,
        why,
        entryTag: tag,
        exitTag,
        structTag,
        label: t.label
      }
    )));
  }
  async function analyzeTradeOnce(day, tradeIndex, underlying, operator, { force = false, onChunk } = {}) {
    const res = await getTradeDna(day, tradeIndex, underlying);
    if (!res || !res.available || !res.dna) return { status: "error", note: res && res.note || "no DNA" };
    if (!force && res.stored && (res.stored.analysis || "").trim()) return { status: "skipped" };
    const prompt = buildAnalystPrompt(res.dna, operator || {}, res.playbook_session);
    const { text, error } = await collectTurn(prompt, `trade-${day}-${tradeIndex}`, { onToken: onChunk });
    if (error && !text) return { status: "error", note: error };
    if (text.trim() && res.trade_key) {
      saveTradeAnalysis({
        day,
        trade_key: res.trade_key,
        underlying,
        label: res.dna.label,
        dna: res.dna,
        analysis: text
      });
      return { status: "saved" };
    }
    return { status: "empty" };
  }
  function AnalyzeTrade({ day, tradeIndex, underlying, why, entryTag, exitTag, structTag, label }) {
    const [state, setState] = useState16(null);
    const abortRef = useRef5(null);
    const readRef = useRef5(null);
    const busy = state === "loading" || state === "streaming";
    const run = async () => {
      setState("loading");
      const res = await getTradeDna(day, tradeIndex, underlying);
      if (!res || !res.available || !res.dna) {
        setState({ error: res && res.note || "couldn't build the trade DNA" });
        return;
      }
      const prompt = buildAnalystPrompt(res.dna, { why, entryTag, exitTag, structTag }, res.playbook_session);
      setState("streaming");
      const { text, error } = await collectTurn(prompt, `trade-${day}-${tradeIndex}`, {
        onToken: (t) => setState({ text: t }),
        setAbort: (fn) => {
          abortRef.current = fn;
        }
      });
      if (error && !text) {
        setState({ error });
        return;
      }
      if (text.trim() && res.trade_key) {
        saveTradeAnalysis({
          day,
          trade_key: res.trade_key,
          underlying,
          label: res.dna.label,
          dna: res.dna,
          analysis: text
        });
      }
      setState({ text, dna: res.dna, saved: !!text.trim() });
      setTimeout(() => readRef.current && readRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
    };
    useEffect13(() => {
      let live = true;
      (async () => {
        const res = await getTradeDna(day, tradeIndex, underlying);
        if (live && res && res.stored) {
          setState({
            text: res.stored.analysis || "",
            dna: res.stored.dna && res.stored.dna.label ? res.stored.dna : res.dna,
            saved: true,
            analyzedAt: res.stored.analyzed_at
          });
        }
      })();
      return () => {
        live = false;
        if (abortRef.current) abortRef.current();
      };
    }, [day, tradeIndex, underlying]);
    return /* @__PURE__ */ React.createElement("div", { className: "vg-loadhost", style: { marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--vg-hairline)" } }, busy && /* @__PURE__ */ React.createElement(LoadBar, null), /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: 0 } }, "The DNA \u2014 Mira's read"), busy ? /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-btn-sm",
        disabled: true,
        "aria-busy": "true",
        style: { opacity: 0.7, cursor: "wait" }
      },
      /* @__PURE__ */ React.createElement("span", { className: "vg-spin", "aria-hidden": "true" }, "\u27F3"),
      " Analyzing\u2026"
    ) : typeof state === "object" && state && state.text != null ? /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: run }, "\u21BB Re-analyze") : /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: run }, "\u{1F9EC} Analyze this trade")), busy && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8 } }, state === "loading" ? "Building the DNA (price action \xB7 volume \xB7 technicals \xB7 levels) and reading news + sentiment\u2026" : "Mira is writing the desk review\u2026"), typeof state === "object" && state && state.error && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, color: "var(--vg-down)" } }, state.error), typeof state === "object" && state && state.text != null && /* @__PURE__ */ React.createElement("div", { ref: readRef }, state.dna && /* @__PURE__ */ React.createElement(FvgAtEntry, { ict: state.dna.ict }), state.text.trim() && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement(MiraRender, { text: state.text })), state.dna && /* @__PURE__ */ React.createElement(DnaReadout, { dna: state.dna }), state.modelUnavailable && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { fontSize: 12, marginTop: 6 } }, "The narrative read is pending Mira's turn-path model synthesis; the full structured DNA above is the complete record."), state.saved && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { fontSize: 12, marginTop: 4 } }, "\u2713 saved to this trade's record", state.analyzedAt ? ` \xB7 ${String(state.analyzedAt).slice(0, 16).replace("T", " ")}` : "")));
  }
  function DnaReadout({ dna }) {
    const e = dna.entry, x = dna.exit;
    const et = e.technicals || {}, xt = x.technicals || {};
    const eq = e.quality || {}, xq = x.quality || {};
    const en = e.correlation && e.correlation.nearest;
    const xn = x.correlation && x.correlation.nearest;
    const pts2 = (v) => v == null ? "\u2014" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}pt`;
    const call = String(dna.strategy).includes("call");
    const entryRead = eq.pre_move == null ? "" : (eq.pre_move < 0 ? `price pulled back ${pts2(eq.pre_move)} into the fill (bought the dip)` : `price ran ${pts2(eq.pre_move)} into the fill (bought strength)`) + (eq.post_move != null ? `, then moved ${pts2(eq.post_move)} in your favor` : "");
    const exitRead = xq.pre_move == null ? "" : (xq.pre_move > 0 ? `price spiked ${pts2(xq.pre_move)} into the exit (sold into strength)` : `price was falling ${pts2(xq.pre_move)} into the exit`) + (xq.post_move != null ? `, then went ${pts2(xq.post_move)} after` : "");
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { maxWidth: 560 } }, /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { style: { width: 70 } }, /* @__PURE__ */ React.createElement("b", null, "Timeframe")), /* @__PURE__ */ React.createElement("td", null, dna.timeframe, " \xB7 ", dna.bar_interval, " bars", dna.coarse ? " (1m unavailable \u2014 coarse)" : "")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "Entry")), /* @__PURE__ */ React.createElement("td", null, dna.underlying || "SPX", " ", /* @__PURE__ */ React.createElement("b", null, e.spot), en ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \u2014 ", en.at_level || e.correlation && e.correlation.at_level ? "at " : "near ", "the ", /* @__PURE__ */ React.createElement("b", null, en.level), " ", en.role, " (", (en.kinds || []).join(" + "), "), ", pts2(en.distance), " away") : "", ".", " ", entryRead, ".")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, "VWAP ", et.vwap, " (", et.vs_vwap >= 0 ? "+" : "", et.vs_vwap, " vs price)", et.rsi != null ? ` \xB7 RSI ${Math.round(et.rsi)}` : "", " \xB7 rel-vol ", et.rel_volume, "\xD7 \xB7 ATR ", et.atr)), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "Exit")), /* @__PURE__ */ React.createElement("td", null, dna.underlying || "SPX", " ", /* @__PURE__ */ React.createElement("b", null, x.spot), x.is_settlement ? " (expiry settlement)" : "", xn ? /* @__PURE__ */ React.createElement(React.Fragment, null, " \u2014 ", x.correlation && x.correlation.at_level ? "at " : "near ", "the ", /* @__PURE__ */ React.createElement("b", null, xn.level), " ", xn.role, " (", (xn.kinds || []).join(" + "), "), ", pts2(xn.distance), " away") : "", ".", " ", exitRead, ".")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, "VWAP ", xt.vwap, " (", xt.vs_vwap >= 0 ? "+" : "", xt.vs_vwap, " vs price)", xt.rsi != null ? ` \xB7 RSI ${Math.round(xt.rsi)}${xt.rsi >= 70 ? " (extended)" : ""}` : "", " \xB7 rel-vol ", xt.rel_volume, "\xD7 \xB7 ATR ", xt.atr)), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "Result")), dna.realized == null ? /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, "open"), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\xB7 no realized P&L yet")) : /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", { className: dna.realized >= 0 ? "vg-up" : "vg-down" }, dna.realized >= 0 ? "+" : "\u2212", "$", Math.abs(dna.realized).toLocaleString()), " ", "\xB7 ", dna.status.replace("_", " "))))));
  }
  function FvgAtEntry({ ict }) {
    const ctx = ict && ict.entry_context;
    if (!ctx) return null;
    const tfs = ["1m", "5m", "15m"];
    const fvgs = ctx.fvgs_at_entry || {};
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { fontSize: 12 } }, "Structure at entry ", /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { fontWeight: 400 } }, "\u2014 unfilled gaps within \xB1", ctx.tol_pct, "% of the ", ctx.entry_price, " fill \xB7 code, never Mira")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginTop: 4 } }, tfs.map((tf) => {
      const rows = fvgs[tf] || [];
      return /* @__PURE__ */ React.createElement("details", { key: tf, style: { minWidth: 150 } }, /* @__PURE__ */ React.createElement("summary", { className: "vg-note", style: { cursor: "pointer" } }, tf, " gaps ", /* @__PURE__ */ React.createElement("b", { className: rows.length ? void 0 : "vg-faint" }, "(", rows.length, ")")), rows.length ? /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("tbody", null, rows.map((g, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", g.side === "bull" ? "good" : "bad") }, g.side)), /* @__PURE__ */ React.createElement("td", { className: "num" }, g.lo, "\u2013", g.hi), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, g.formed_at, g.inside ? " \xB7 entry inside" : ` \xB7 ${g.dist_pt}pt away`))))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "4px 0 0" } }, "none adjacent"));
    }), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "HTF sweeps:", " ", (ctx.htf_sweeps || []).length ? ctx.htf_sweeps.map((s, i) => /* @__PURE__ */ React.createElement(
      "span",
      {
        key: i,
        className: cls("vg-badge", s.side === "SSL" ? "good" : "bad"),
        style: { marginRight: 4 },
        title: `hourly swing ${s.level} wicked through and reclaimed ${s.hours_before_entry}h before entry`
      },
      s.side,
      " ",
      s.level,
      " \xB7 ",
      s.hours_before_entry,
      "h ago"
    )) : "none in the last 12 hourly bars")));
  }
  function buildAnalystPrompt(dna, operator, session) {
    const j = (o) => JSON.stringify(o);
    const e = dna.entry, x = dna.exit;
    const { why, entryTag, exitTag, structTag } = operator || {};
    const win = (w) => (w || []).map((b) => `  ${b.time}  O${b.open} H${b.high} L${b.low} C${b.close}  vol ${b.volume}${b.at_fill ? "  \xABFILL\xBB" : ""}`).join("\n");
    const operatorBlock = [];
    if (why) operatorBlock.push(`- Their stated reasoning: "${why}"`);
    if (entryTag) operatorBlock.push(`- They say they entered on the ${entryTag} level.`);
    if (exitTag) operatorBlock.push(`- They say they exited on the ${exitTag} level.`);
    if (structTag) operatorBlock.push(
      `- They say the STRUCTURE they traded off was: "${structTag}". This is their declared setup \u2014 evaluate the trade AGAINST it, not as an unplanned entry: was that structure real and adjacent at the fill (cross-check the ICT block above), was trading it in this direction coherent, and did it hold or fail? If the entry price/timing is inconsistent with actually trading that structure, say so.`
    );
    return [
      `Review this options trade AND critique the operator's own reasoning against the tape, the technicals, and best practice. Be a demanding desk mentor \u2014 validate what was sound, call out what was wrong or lucky. All the DNA is below; use ONLY these numbers.`,
      ``,
      `TRADE: ${dna.label} (${dna.strategy}), a ${dna.timeframe} on ${dna.underlying}. Opened ${dna.opened_at}, closed ${dna.closed_at}. Realized P&L $${dna.realized}.`,
      dna.coarse ? `Note: price action is 15-minute bars (1-minute unavailable this far back).` : ``,
      dna.scale ? `THIS WAS A SCALED POSITION (${dna.scale.peak_contracts}\xD7 peak): ${dna.scale.entries} entries at avg $${dna.scale.avg_entry}, ${dna.scale.exits} exits at avg $${dna.scale.avg_exit}${dna.scale.add_behavior ? `, ${dna.scale.add_behavior}` : ""}${dna.scale.exit_style ? `, ${dna.scale.exit_style}` : ""}. The full fill ladder (time/side/price/running position): ${j(dna.fills)}. JUDGE THE SCALING \u2014 adding on strength vs averaging down, laddering the exit vs one-shot, and whether the geometry was disciplined or hope.` : ``,
      ``,
      `THE FORECAST for the session (levels the operator planned around): ${j(dna.forecast_levels)}. GEX anchors: ${j(dna.gex_anchors)}.`,
      dna.standing_forecast ? [
        ``,
        `THE STANDING ANALYST FORECAST when this trade was entered (made ${dna.standing_forecast.age_min_at_entry} min before entry, at ${dna.underlying} ${dna.standing_forecast.price_at}): bias ${dna.standing_forecast.bias || "?"}, target ${dna.standing_forecast.target ?? "\u2014"}, invalidation ${dna.standing_forecast.invalidation ?? "\u2014"}${dna.standing_forecast.born_invalid ? " \u2014 NOTE: this forecast was flagged BORN-INVALID (issued beyond its own invalidation)" : ""}${dna.standing_forecast.score_verdict ? `. It was later scored: ${dna.standing_forecast.score_verdict}` : ""}.`,
        `JUDGE THE ALIGNMENT: did the operator trade WITH or AGAINST the standing forecast? Given how both resolved, which of them read the tape right \u2014 and should the operator have weighted the forecast more or less?`
      ].join("\n") : ``,
      ``,
      `ENTRY at ${dna.underlying} ${e.spot}. Nearest forecast level: ${j(e.correlation && e.correlation.nearest)}. Technicals at entry: ${j(e.technicals)}. Fill-quality read: ${j(e.quality)}.`,
      `Price action around the entry:`,
      win(e.window),
      ``,
      `EXIT at ${dna.underlying} ${x.spot}${x.is_settlement ? " (this was the expiry settlement, not a sell)" : ""}. Nearest forecast level: ${j(x.correlation && x.correlation.nearest)}. Technicals at exit: ${j(x.technicals)}. Fill-quality read: ${j(x.quality)}.`,
      `Price action around the exit:`,
      win(x.window),
      ``,
      dna.ict ? [
        `ICT STRUCTURE AT ENTRY (deterministic engine, time-anchored to the fill): draw ${j(dna.ict.draw)} \xB7 flags ${j(dna.ict.flags)} \xB7 hourly setup ${j(dna.ict.htf_setup)}.`,
        dna.ict.entry_context ? `FVGs ADJACENT TO THE ENTRY PRICE (${dna.ict.entry_context.entry_price}, \xB1${dna.ict.entry_context.tol_pct}%) by timeframe: ${j(dna.ict.entry_context.fvgs_at_entry)}. RECENT HOURLY LIQUIDITY SWEEPS before entry (wick through a swing, close back): ${j(dna.ict.entry_context.htf_sweeps)}.` : ``,
        `WEIGH THIS STRUCTURE: was the entry into/off an adjacent FVG, and did it follow an HTF sweep? Say whether the structure supported or fought this entry \u2014 as context alongside the tape, not as a signal by itself (level/FVG adjacency has no standalone backtested edge here).`
      ].filter(Boolean).join("\n") : ``,
      ``,
      dna.news ? `NEWS & SENTIMENT for ${dna.news.symbol} that session (sentiment is an ESTIMATED lexicon lean over headlines, not ground truth \u2014 cite it as such): ${j(dna.news)}.` : `No news available for the session.`,
      ``,
      operatorBlock.length ? `THE OPERATOR'S OWN VIEW \u2014 critique this directly against the data above:
${operatorBlock.join("\n")}` : `The operator left no note on their thinking \u2014 flag that journaling the WHY would let this review critique the reasoning, not just the result.`,
      ``,
      `Write a tight desk review, specific with the numbers:`,
      `1. ENTRY quality \u2014 bought strength or caught a knife? At a real level? What did volume/VWAP say?`,
      `2. EXIT quality \u2014 sold a spike or gave it back? At a level? Extended (VWAP/RSI)?`,
      `3. RESPECT THE PLAN \u2014 enter/exit at forecast levels, in line with the tape?`,
      `4. CRITIQUE THE OPERATOR'S REASONING \u2014 does their stated why (and the levels they claim they traded) hold up against what the tape and technicals actually did? Were they right for the right reasons, right for the wrong reasons, or wrong? If their tagged level doesn't match the DNA's nearest level, say so.`,
      `5. NEWS/SENTIMENT \u2014 did the session's news context support or undercut this trade? Any risk they ignored?`,
      `6. One concrete LESSON \u2014 the single most useful thing to do differently.`,
      `Be direct and demanding. No disclaimers.`,
      ``,
      `Return ONLY a JSON object (no prose outside it, no code fences) in this shape:`,
      `{"headline":"<one-line verdict on the trade>","sections":[`,
      `  {"kind":"keyvals","title":"Entry & exit","rows":[{"k":"Entry","v":"<quality read, cite the numbers>","tone":"good|bad|warn"},{"k":"Exit","v":"<quality read>","tone":"good|bad|warn"}]},`,
      `  {"kind":"list","title":"Plan & reasoning","items":[{"point":"<did they respect forecast levels / the tape>"},{"point":"<critique of their stated why vs the data>"}]},`,
      `  {"kind":"callout","title":"News read","text":"<did session news support or undercut this>","tone":"good|bad|warn"},`,
      `  {"kind":"donext","items":[{"title":"<the one lesson>","detail":"<how to apply it>"}]}`,
      `]}`,
      `Every claim must use the numbers above. If you can't produce valid JSON, write the review as plain prose instead.`
    ].filter((l) => l !== ``).join("\n");
  }
  function CorrTable({ title, corr, openSpace }) {
    const nearest3 = corr && corr.nearest;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { fontSize: 12 } }, title), corr && corr.nearby && corr.nearby.length ? /* @__PURE__ */ React.createElement("table", { className: "vg-mini" }, /* @__PURE__ */ React.createElement("tbody", null, corr.nearby.map((c, i) => /* @__PURE__ */ React.createElement("tr", { key: i, className: c.level === nearest3.level ? "vg-hl" : "" }, /* @__PURE__ */ React.createElement("td", null, fmtLvl(c.level)), /* @__PURE__ */ React.createElement("td", null, c.role, " ", (c.kinds || []).length ? `\xB7 ${c.kinds.join(" + ")}` : "", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, " [", c.source, "]")), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right" } }, c.distance > 0 ? "+" : "", c.distance, "pt"))))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { fontSize: 13, margin: "2px 0" } }, "No forecast level within range \u2014 ", openSpace, "."));
  }
  function FillLadder({ fills, scale }) {
    const [open, setOpen] = useState16(false);
    if (!scale || !fills || fills.length <= 2) return null;
    const svg = (n) => n == null ? "\u2014" : `$${Number(n).toFixed(2)}`;
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { fontSize: 12 } }, "The ladder \u2014 ", scale.peak_contracts, "\xD7 peak"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { fontSize: 13, margin: "2px 0 4px" } }, scale.entries, " ", scale.entries === 1 ? "entry" : "entries", " @ avg ", svg(scale.avg_entry), " \u2192 ", scale.exits, " ", scale.exits === 1 ? "exit" : "exits", " @ avg ", svg(scale.avg_exit), scale.add_behavior ? /* @__PURE__ */ React.createElement("span", null, " \xB7 ", /* @__PURE__ */ React.createElement("b", null, scale.add_behavior)) : null, scale.exit_style ? /* @__PURE__ */ React.createElement("span", null, " \xB7 ", scale.exit_style) : null), /* @__PURE__ */ React.createElement("button", { className: "vg-btn-sm", onClick: () => setOpen((v) => !v) }, open ? "\u25BE hide fills" : `\u25B8 show all ${fills.length} fills`), open && /* @__PURE__ */ React.createElement("table", { className: "vg-mini", style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 5, className: "vg-note", style: { fontSize: 12, paddingBottom: 2 } }, "times in ET (market hours)")), fills.map((r, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, r.at_et || (r.at || "").slice(11, 16)), /* @__PURE__ */ React.createElement("td", { className: r.side === "buy" ? "vg-up" : "vg-down" }, r.side), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right" } }, r.qty, "\xD7"), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right" } }, svg(r.price)), /* @__PURE__ */ React.createElement("td", { className: "vg-note", style: { textAlign: "right" } }, "\u2192 ", r.running, " held"))))));
  }

  // src/trades.jsx
  var { useMemo: useMemo5 } = React;
  var pct6 = (v) => v == null ? "\u2014" : `${Math.round(v * 100)}%`;
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
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4, fontSize: 12 } }, "CI ", pct12(ciLow), "\u2013", pct12(ciHigh), " \xB7 baseline ", pct12(baseline)));
  }
  function Scorecard({ summary }) {
    const s = summary || {};
    const pf = s.profit_factor;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Win rate", value: pct12(s.win_rate), note: `${s.wins ?? 0}W / ${s.losses ?? 0}L` }), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Profit factor",
        value: num(pf),
        delta: pf == null ? null : pf >= 1 ? "profitable" : "below breakeven",
        deltaDir: pf != null && pf >= 1 ? "up" : "down"
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Avg hold",
        value: s.avg_holding_days == null ? "\u2014" : `${num(s.avg_holding_days, 1)}d`
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Avg MFE capture",
        value: pct6(s.avg_mfe_capture),
        note: "share of peak move captured"
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Closed trades",
        value: s.count ?? 0,
        note: s.entry_unknown ? `${s.entry_unknown} est. entry` : null
      }
    ));
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
    } }, significant.map((b) => /* @__PURE__ */ React.createElement("div", { key: `${b.dimension}:${b.value}`, className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 14 } }, b.value), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", b.kind === "leak" ? "bad" : "good") }, b.kind === "leak" ? "\u25BC leak" : "\u25B2 edge")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 2 } }, b.dimension.replace(/_/g, " ")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24, fontWeight: 700 } }, pct12(b.win_rate)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-note", b.kind === "leak" ? "down" : "up") }, signPct((b.win_rate - (baseline || 0)) * 100), " vs baseline")), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "n = ", b.n, " trades"), /* @__PURE__ */ React.createElement(
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { marginTop: 8, padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 13, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Condition"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "n"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Win rate"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Credible interval (90%)"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Avg P/L"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((b) => {
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
        const u = underlyingOf(sym);
        setSymbol(u);
        go("ic", u);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { marginTop: 8, padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 13, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Symbol"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Kind"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Open \u2192 Close"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Held"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "Realized $"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "%"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px" } }, "Result"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 12px", textAlign: "right" } }, "MFE capture"))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((r, i) => /* @__PURE__ */ React.createElement(
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
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, pct6(r.mfe_capture))
    )))));
  }
  var TR_TABS = [
    { key: "swings", label: "Swings" },
    { key: "futures", label: "Futures" }
  ];
  function TradeAnalyticsView({ accountId, settings, setSymbol, go, tab = "swings", onTab }) {
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", flexWrap: "wrap", gap: 10 } }, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Track record"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 4 } }, TR_TABS.map((t) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: t.key,
        className: cls("vg-seg-btn", tab === t.key && "on"),
        onClick: () => onTab && onTab(t.key)
      },
      t.label
    )))), tab === "futures" && /* @__PURE__ */ React.createElement(FuturesView, null), tab !== "futures" && /* @__PURE__ */ React.createElement(SwingsTab, { accountId, settings, setSymbol, go }));
  }
  function SwingsTab({ accountId, settings, setSymbol, go }) {
    const rt = useLive(() => getRoundtrips(accountId), null, [accountId, settings]).data;
    const ts = useLive(() => getTradeStats(accountId), null, [accountId, settings]).data;
    const summary = rt && rt.summary;
    const hasTrades = summary && summary.count > 0;
    const asOf = rt && rt.roundtrips_as_of || ts && ts.trade_stats_as_of || null;
    const baseline = ts && ts.baseline_win_rate;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { marginTop: 8 } }, "Swing round-trips \u2014 multi-day equity/option positions reconstructed from brokerage history, with statistically-defensible edges", asOf ? ` \xB7 as of ${asOf}` : "", " \xB7 educational only, not advice"))), !hasTrades ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No trade analysis available"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0", maxWidth: 620 } }, "The round-trip journal and condition stats haven't been built yet, or the backend is unreachable. Run the trade-analysis build (it also runs nightly), then confirm the backend URL in Settings."), /* @__PURE__ */ React.createElement("pre", { style: {
      background: "var(--color-light)",
      border: "1px solid var(--color-border)",
      borderRadius: 8,
      padding: "10px 12px",
      margin: "10px 0 0",
      fontSize: 13,
      lineHeight: 1.5,
      overflowX: "auto"
    } }, /* @__PURE__ */ React.createElement("code", null, "cd server\n.venv/bin/python -m vantage_server.ml.build_roundtrips --account rh-margin --broker-account <N>\n.venv/bin/python -m vantage_server.ml.build_features --account rh-margin --from-roundtrips"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(Scorecard, { summary })), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "Defensible edges & leaks"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "2px 0 0", maxWidth: 620 } }, "Only conditions whose 90% credible interval clears your ", pct12(baseline), " baseline with enough trades to matter. Anything thinner is held back below."), /* @__PURE__ */ React.createElement(NotableCards, { notable: ts && ts.notable, baseline }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "All conditions"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "2px 0 0", maxWidth: 620 } }, "Every entry condition by win-rate and credible interval. Rows with too few trades to be defensible are muted and marked \u201Cn too small\u201D \u2014 don't read them as signal."), /* @__PURE__ */ React.createElement(ConditionTable, { buckets: ts && ts.buckets, baseline }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "Recent round-trips"), /* @__PURE__ */ React.createElement(RoundtripsTable, { roundtrips: rt && rt.roundtrips, setSymbol, go })));
  }

  // src/app.jsx
  var { useState: useState17, useMemo: useMemo6, useEffect: useEffect14, useRef: useRef6, useCallback: useCallback5 } = React;
  var { Navbar, Button, Modal, FormField, SecurityCard, FAQItem } = window.LookeyDS;
  var EMPTY_ALLOC = { byClass: { usEquity: 0, intlEquity: 0, bonds: 0, cash: 0 }, total: 0 };
  var NAV = [
    { group: "Desk", items: [
      // Cockpit: the app's home — the merged Daily plan + live day surface.
      // Home/faces and the standalone Daily plan RETIRED (IA streamline):
      // #/home*, #/today, #/playbook all redirect here; #/dashboard → portfolio.
      { id: "cockpit", label: "Cockpit", icon: "home" },
      { id: "scanner", label: "Strategies", icon: "strategies" },
      // Chart is the chart-first canvas — any instrument, our DNA layers, Mira's read.
      { id: "ic", label: "Chart", icon: "chart" }
    ] },
    { group: "Book", items: [
      { id: "portfolio", label: "Portfolio", icon: "portfolio" },
      { id: "holdings", label: "Positions", icon: "positions" },
      { id: "tax", label: "Tax", icon: "tax" }
    ] },
    { group: "Review", items: [
      { id: "journal", label: "Trading Journal", icon: "journal" },
      { id: "trades", label: "Track record", icon: "performance" }
    ] }
  ];
  var DRILLDOWN_ROUTES = ["activity", "recs", "futures"];
  var ROUTES = [...NAV.flatMap((g) => g.items.map((i) => i.id)), ...DRILLDOWN_ROUTES];
  var defaultRoute = () => "cockpit";
  function useHashRoute() {
    const parse = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      const [r, ...rest] = h.split("/");
      if (r === "today" || r === "home" || r === "playbook") return { route: "cockpit", param: null };
      if (r === "dashboard") return { route: "portfolio", param: null };
      if (r === "options") return { route: "holdings", param: null };
      if (r === "paper" || r === "strategies") return { route: "scanner", param: null };
      const route = ROUTES.includes(r) ? r : defaultRoute();
      const param = rest.length ? decodeURIComponent(rest.join("/")) : null;
      return { route, param };
    };
    const [state, setState] = useState17(parse);
    useEffect14(() => {
      const onHash = () => setState(parse());
      window.addEventListener("hashchange", onHash);
      return () => window.removeEventListener("hashchange", onHash);
    }, []);
    const go = (r, param) => {
      window.location.hash = param ? `/${r}/${encodeURIComponent(param)}` : `/${r}`;
      const center = document.getElementById("vg-center");
      if (center) center.scrollTo({ top: 0 });
    };
    return [state.route, go, state.param];
  }
  function CommandPalette({ open, onClose, go }) {
    const [q, setQ] = useState17("");
    const [sel, setSel] = useState17(0);
    const inputRef = useRef6(null);
    useEffect14(() => {
      if (open) {
        setQ("");
        setSel(0);
        setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
      }
    }, [open]);
    if (!open) return null;
    const needle = q.trim().toLowerCase();
    const navItems = NAV.flatMap((g) => g.items.map((i) => ({
      key: i.id,
      label: i.label,
      note: g.group,
      run: () => go(i.id)
    }))).filter((i) => !needle || i.label.toLowerCase().includes(needle));
    const items = [...navItems];
    if (/^[a-z.\-]{1,10}$/i.test(needle) && needle.length >= 1) {
      items.push({
        key: `tk-${needle}`,
        label: `Open chart \xB7 ${needle.toUpperCase()}`,
        note: "symbol",
        run: () => go("ic", needle.toUpperCase())
      });
    }
    const pick = (it) => {
      it.run();
      onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter" && items[sel]) {
        e.preventDefault();
        pick(items[sel]);
      }
    };
    return /* @__PURE__ */ React.createElement("div", { className: "vg-pal-scrim", onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-pal", onClick: (e) => e.stopPropagation(), onKeyDown: onKey }, /* @__PURE__ */ React.createElement(
      "input",
      {
        ref: inputRef,
        className: "vg-pal-input",
        value: q,
        placeholder: "Jump to a screen, or type a ticker\u2026",
        onChange: (e) => {
          setQ(e.target.value);
          setSel(0);
        },
        "aria-label": "Command palette"
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-pal-list", role: "listbox" }, items.map((it, i) => /* @__PURE__ */ React.createElement(
      "div",
      {
        key: it.key,
        role: "option",
        "aria-selected": i === sel,
        className: cls("vg-pal-item", i === sel && "on"),
        onMouseEnter: () => setSel(i),
        onClick: () => pick(it)
      },
      /* @__PURE__ */ React.createElement("span", null, it.label),
      /* @__PURE__ */ React.createElement("span", { className: "vg-pal-note" }, it.note)
    )), !items.length && /* @__PURE__ */ React.createElement("div", { className: "vg-pal-empty" }, "no match"))));
  }
  function App() {
    const [settings, setSettings] = useState17(loadSettings);
    const [accountId, setAccountId] = useState17(settings.defaultAccount);
    const [symbol, setSymbol] = useState17("SPY");
    const [route, go, routeParam] = useHashRoute();
    const [notifs, setNotifs] = useState17([]);
    const [notifOpen, setNotifOpen] = useState17(false);
    const [chatOpen, setChatOpen] = useState17(false);
    const [settingsOpen, setSettingsOpen] = useState17(false);
    const [leftOpen, setLeftOpen] = useState17(() => window.innerWidth >= 860);
    const [rightOpen, setRightOpen] = useState17(() => window.innerWidth >= 1100);
    const [focus, setFocus] = useState17(false);
    const focusPrev = useRef6({ left: true, right: true });
    const enterFocus = useCallback5(() => {
      focusPrev.current = { left: leftOpen, right: rightOpen };
      setLeftOpen(false);
      setRightOpen(false);
      setFocus(true);
    }, [leftOpen, rightOpen]);
    const exitFocus = useCallback5(() => {
      setLeftOpen(focusPrev.current.left);
      setRightOpen(focusPrev.current.right);
      setFocus(false);
    }, []);
    const toggleFocus = useCallback5(() => {
      focus ? exitFocus() : enterFocus();
    }, [focus, enterFocus, exitFocus]);
    useEffect14(() => {
      const onKey = (e) => {
        const el = e.target;
        const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          toggleFocus();
        } else if (e.key === "Escape" && focus) {
          e.preventDefault();
          exitFocus();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [toggleFocus, exitFocus, focus]);
    const [palOpen, setPalOpen] = useState17(false);
    useEffect14(() => {
      const onKey = (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
          e.preventDefault();
          setPalOpen((v) => !v);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, []);
    const RIGHT_MIN = 300;
    const rightMax = () => Math.min(1100, Math.round(window.innerWidth * 0.5));
    const [rightWidth, setRightWidth] = useState17(() => {
      const saved = Number(localStorage.getItem("vantage.rightWidth"));
      return saved >= RIGHT_MIN ? Math.min(saved, rightMax()) : 360;
    });
    const [resizing, setResizing] = useState17(false);
    const startResize = (e) => {
      e.preventDefault();
      setResizing(true);
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (ev) => {
        const next = Math.min(rightMax(), Math.max(RIGHT_MIN, startW + (startX - ev.clientX)));
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
    const rightWidthRef = useRef6(rightWidth);
    rightWidthRef.current = rightWidth;
    const [refreshNonce, setRefreshNonce] = useState17(0);
    const [refreshing, setRefreshing] = useState17({});
    const [refreshNote, setRefreshNote] = useState17(null);
    useEffect14(() => {
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
          refreshable: a.refreshable,
          has_holdings: a.has_holdings,
          has_transactions: a.has_transactions
        }));
      }),
      [],
      [settings, refreshNonce],
      // re-fetch the rail after a refresh completes
      { blankOnOutage: true }
    );
    const scopeAccounts = scopeLive.data;
    const marketBand = useLive(() => quotes().then(mapMarketBand), null, [settings, refreshNonce]).data;
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
    const [replayOn, setReplayOn] = useState17(false);
    const [replayRunId, setReplayRunId] = useState17(null);
    const [activeCallId, setActiveCallId] = useState17(null);
    const [forecastNowSignal, setForecastNowSignal] = useState17(0);
    const [forecastSavedNonce, setForecastSavedNonce] = useState17(0);
    const showReplayPanel = route === "ic" && replayOn;
    const showDeskRail = ["scanner", "journal", "trades"].includes(route);
    const showCockpitPanel = route === "cockpit";
    const icSymbol = route === "ic" ? (routeParam || "SPX").toUpperCase() : null;
    useEffect14(() => {
      if (icSymbol) setSymbol(icSymbol);
    }, [icSymbol]);
    useEffect14(() => {
      if (route !== "ic") {
        setReplayOn(false);
        setReplayRunId(null);
        setActiveCallId(null);
      }
    }, [route]);
    useEffect14(() => {
      setReplayRunId(null);
      setActiveCallId(null);
    }, [icSymbol]);
    return /* @__PURE__ */ React.createElement("div", { className: "vg-app" }, /* @__PURE__ */ React.createElement(CommandPalette, { open: palOpen, onClose: () => setPalOpen(false), go }), /* @__PURE__ */ React.createElement("div", { className: "vg-compliance" }, "AI-generated analysis \xB7 Educational purposes only \u2014 not financial, investment, or tax advice"), /* @__PURE__ */ React.createElement("div", { className: "vg-topbar" }, /* @__PURE__ */ React.createElement("div", { className: "brand" }, "Vantage"), /* @__PURE__ */ React.createElement("div", { className: "vg-ticker", style: { flex: 1, borderBottom: "none" } }, marketBand && marketBand.indexes.map((t) => /* @__PURE__ */ React.createElement("span", { className: "vg-tick", key: t.sym }, /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { textTransform: "uppercase", letterSpacing: ".06em", fontSize: 12 } }, t.label), /* @__PURE__ */ React.createElement("b", null, t.price != null ? t.price.toFixed(2) : "\u2014"), /* @__PURE__ */ React.createElement("span", { className: dirCls(t.dayPct) }, signPct(t.dayPct))))), /* @__PURE__ */ React.createElement("span", { style: { padding: "0 14px" } }, /* @__PURE__ */ React.createElement(LiveStatusDots, { settings })), /* @__PURE__ */ React.createElement("div", { className: "tools" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "tbtn vg-topbar-bell",
        onClick: () => setNotifOpen(true),
        "aria-label": "Notifications"
      },
      "\u{1F514}",
      unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-bell-cnt" }, unread)
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("tbtn", focus && "on"),
        onClick: toggleFocus,
        title: focus ? "Exit focus (Esc)" : "Focus chart \u2014 hide panels (F)",
        "aria-label": "Toggle focus mode"
      },
      focus ? "\u2922 Exit" : "\u2922 Focus"
    ), /* @__PURE__ */ React.createElement(ThemeButton, null), /* @__PURE__ */ React.createElement("button", { className: "tbtn", onClick: () => setSettingsOpen(true) }, "Settings"))), /* @__PURE__ */ React.createElement("div", { className: cls("vg-studio", (leftOpen || rightOpen) && "drawer-open") }, /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "vg-mob-backdrop",
        onClick: () => {
          setLeftOpen(false);
          setRightOpen(false);
        },
        "aria-hidden": "true"
      }
    ), /* @__PURE__ */ React.createElement("aside", { className: cls("vg-pane", "vg-pane-left", !leftOpen && "clps") }, /* @__PURE__ */ React.createElement("div", { className: "vg-pane-top" }, leftOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, "Workspace"), /* @__PURE__ */ React.createElement(
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
      /* @__PURE__ */ React.createElement("span", { className: "ic" }, /* @__PURE__ */ React.createElement(Icon, { name: it.icon })),
      leftOpen && /* @__PURE__ */ React.createElement(React.Fragment, null, it.label, it.id === "tax" && tlh2.some((c) => c.status === "clear") && /* @__PURE__ */ React.createElement("span", { className: "vg-navdot" }))
    ))))), leftOpen && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-divider" }), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-scope-chip",
        onClick: () => go("portfolio"),
        title: "Manage accounts + scope in Portfolio"
      },
      /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { margin: 0 } }, "Scope"),
      /* @__PURE__ */ React.createElement("span", { className: "bal" }, accountId === "all" ? "All accounts" : scopeAccounts.find((a) => a.id === accountId)?.short || accountId),
      /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "accounts \u2192")
    ), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10, padding: "0 4px" } }, "Read-only aggregation. Vantage never holds funds or places orders."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, padding: "0 4px" } }, "Vantage \xB7 built on the Lookey design system \xB7 AI analysis is educational only \u2014 not financial, investment, or tax advice.")))), /* @__PURE__ */ React.createElement("main", { id: "vg-center", className: "vg-pane vg-pane-center" }, route === "portfolio" && /* @__PURE__ */ React.createElement(
      PortfolioView,
      {
        accountId,
        setAccountId,
        scopeAccounts,
        refreshing,
        onRefreshAccount,
        onRefreshAll,
        refreshNote,
        lead: /* @__PURE__ */ React.createElement(BookToday, { ...viewProps }),
        onAccountsChanged: () => setRefreshNonce((n) => n + 1)
      }
    ), route === "cockpit" && /* @__PURE__ */ React.createElement(CockpitView, { refreshNonce }), route === "holdings" && /* @__PURE__ */ React.createElement(HoldingsView, { ...viewProps }), route === "activity" && /* @__PURE__ */ React.createElement(ActivityView, { ...viewProps }), route === "tax" && /* @__PURE__ */ React.createElement(TaxView, { ...viewProps }), route === "recs" && /* @__PURE__ */ React.createElement(RecsView, { ...viewProps }), route === "scanner" && /* @__PURE__ */ React.createElement(ScannerView, { onOpenSymbol: (sym) => {
      setSymbol(sym);
      go("ic", sym);
    } }), route === "journal" && /* @__PURE__ */ React.createElement(
      JournalView,
      {
        refreshNonce,
        tab: routeParam === "analysis" ? "analysis" : "days",
        onTab: (k) => go("journal", k === "analysis" ? "analysis" : "")
      }
    ), route === "futures" && /* @__PURE__ */ React.createElement(FuturesView, { refreshNonce }), route === "trades" && /* @__PURE__ */ React.createElement(
      TradeAnalyticsView,
      {
        ...viewProps,
        refreshNonce,
        tab: routeParam || "swings",
        onTab: (k) => go("trades", k === "swings" ? "" : k)
      }
    ), route === "ic" && /* @__PURE__ */ React.createElement("div", { className: "vg-ic-route" }, /* @__PURE__ */ React.createElement(
      InstrumentChartCard,
      {
        symbol: icSymbol,
        height: "100%",
        replayActive: replayOn,
        replayRunId,
        forecastNonce: forecastSavedNonce,
        activeCallId,
        setActiveCallId,
        onOpenSymbol: (s) => go("ic", s),
        onReplayToggle: () => {
          const next = !replayOn;
          setReplayOn(next);
          if (next) setRightOpen(true);
          else {
            setReplayRunId(null);
            setActiveCallId(null);
          }
        },
        onForecastNow: () => {
          setReplayOn(true);
          setRightOpen(true);
          setForecastNowSignal((n) => n + 1);
        }
      }
    ))), /* @__PURE__ */ React.createElement(
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
      ), rightOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, showReplayPanel ? "\u27F2 Replay" : showCockpitPanel ? "Cockpit" : showDeskRail ? "Desk" : symbol ? "Notebook" : "Vantage AI"), rightOpen && showReplayPanel && /* @__PURE__ */ React.createElement(
        "button",
        {
          className: "vg-linkbtn",
          style: { marginLeft: "auto" },
          title: "Back to the Notebook",
          onClick: () => {
            setReplayOn(false);
            setReplayRunId(null);
            setActiveCallId(null);
          }
        },
        "notebook \u2192"
      )),
      !rightOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-sparkle", "aria-hidden": "true" }, "\u2726"),
      rightOpen && (showReplayPanel ? /* @__PURE__ */ React.createElement(
        ReplayPanel,
        {
          symbol: icSymbol,
          runId: replayRunId,
          setRunId: setReplayRunId,
          activeCallId,
          setActiveCallId,
          forecastSignal: forecastNowSignal,
          onForecastSaved: () => setForecastSavedNonce((n) => n + 1)
        }
      ) : showCockpitPanel ? /* @__PURE__ */ React.createElement(CockpitPanel, { refreshNonce }) : showDeskRail ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DeskRail, { route, refreshNonce }), /* @__PURE__ */ React.createElement(ChatPanel, { docked: true, settings })) : symbol ? /* @__PURE__ */ React.createElement(NotebookPanel, { symbol, accountId, refreshNonce }) : /* @__PURE__ */ React.createElement(ChatPanel, { docked: true, settings }))
    )), !focus && /* @__PURE__ */ React.createElement("div", { className: "vg-mob-handles" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-mob-handle",
        onClick: () => {
          setLeftOpen(!leftOpen);
          setRightOpen(false);
        }
      },
      "\u2630 Menu"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-mob-handle",
        onClick: () => {
          setRightOpen(!rightOpen);
          setLeftOpen(false);
        }
      },
      "\u2726 Mira"
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-fabs" }, /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Notifications", onClick: () => setNotifOpen(true) }, "\u{1F514}", unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "cnt" }, unread)), !rightOpen && /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Vantage AI chat", onClick: () => setChatOpen(true) }, "\u{1F4AC}")), notifOpen && /* @__PURE__ */ React.createElement(
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
    const [st, setSt] = useState17({ backend: null, mira: null });
    useEffect14(() => {
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
    return /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { display: "inline-flex", gap: 14, alignItems: "center", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { title: st.backend ? `Backend live at ${settings.backendUrl} \u2014 quotes: ${st.backend.source}${st.backend.stale ? " (stale)" : ""}, as of ${st.backend.as_of}` : `Backend unreachable at ${settings.backendUrl} \u2014 views show empty states` }, /* @__PURE__ */ React.createElement("span", { style: dot(st.backend) }), "data ", st.backend ? "live" : "down"), /* @__PURE__ */ React.createElement("span", { title: aiOff ? "AI backend set to Off in Settings \u2014 canned demo replies" : st.mira ? `Mira reachable at ${settings.miraUrl}` : `Mira unreachable at ${settings.miraUrl} \u2014 canned demo replies` }, /* @__PURE__ */ React.createElement("span", { style: dot(!aiOff && st.mira) }), "AI ", aiOff ? "off" : st.mira ? "live" : "down"));
  }
  function buildActionQueue({ decisions, tlh: tlh2, alloc, totalValue, accountId, settings, go, setSymbol }) {
    const jumpChart = (sym) => {
      const u = underlyingOf(sym);
      setSymbol(u);
      go("ic", u);
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
        const pct7 = alloc.byClass[k] / totalValue * 100;
        const drift = pct7 - ALLOCATION_TARGETS[k];
        if (Math.abs(drift) >= 3) {
          out.push({
            key: `drift-${k}`,
            weight: 3,
            tone: drift > 0 ? "warn" : "info",
            chip: "REBALANCE",
            title: `${m.label} ${signPct(drift, 1)} vs target (${pct7.toFixed(1)}% / ${ALLOCATION_TARGETS[k]}%)`,
            sub: drift > 0 ? "Overweight \u2014 trim on the next contribution." : "Underweight \u2014 direct new cash here.",
            onJump: () => go("holdings")
          });
        }
      }
    }
    return out.sort((a, b) => a.weight - b.weight);
  }
  function BookToday({ accountId, settings, tlh: tlh2, go, setSymbol, refreshNonce }) {
    const posLive = useLive(() => positions(accountId).then(mapPositions), [], [accountId, settings, refreshNonce], { blankOnOutage: true });
    const allocLive = useLive(() => allocation(accountId).then(mapAllocation), EMPTY_ALLOC, [accountId, settings, refreshNonce], { blankOnOutage: true });
    const pos = posLive.data;
    const alloc = allocLive.data;
    const dashLoading = posLive.loading || allocLive.loading;
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
    const actions = buildActionQueue({ decisions, tlh: tlh2, alloc, totalValue, accountId, settings, go, setSymbol });
    return /* @__PURE__ */ React.createElement("div", { className: "vg-loadhost" }, dashLoading && /* @__PURE__ */ React.createElement(LoadBar, null), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: "14px 2px 6px" } }, "Today \xB7 marked to last close"), /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Total value", value: isMixed ? moneyByCcy(byCurrency) : usd(totalValue) }), /* @__PURE__ */ React.createElement(
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
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { margin: "20px 2px 6px" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Actions", actions.length ? ` (${actions.length})` : ""), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => go("recs") }, "All recommendations \u2192")), actions.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, analysis ? "Nothing needs you today \u2014 no close, covered-call, harvest, or rebalance actions. Monitoring the rest." : "The decision journal is empty or the backend is unreachable. Run the nightly analysis and confirm the backend URL in Settings.")) : /* @__PURE__ */ React.createElement("div", { className: "vg-actionq" }, actions.map((a) => /* @__PURE__ */ React.createElement(
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
    const [expanded, setExpanded] = useState17({});
    const [view, setView] = useState17("underlying");
    const [sortKey, setSortKey] = useState17("value");
    const [recFilter, setRecFilter] = useState17("all");
    const [kindFilter, setKindFilter] = useState17("all");
    const [query, setQuery] = useState17("");
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
      const u = underlyingOf(sym);
      if (setSymbol) setSymbol(u);
      if (go) go("ic", u);
    };
    const actionable = groups.filter((g) => (REC_ORDER[g._rec?.recommendation] ?? 9) <= 1).length;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { alignItems: "baseline", flexWrap: "wrap", gap: 10 } }, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Holdings"), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 4 } }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-seg-btn", view === "underlying" && "on"),
        onClick: () => setView("underlying")
      },
      "By underlying"
    ), /* @__PURE__ */ React.createElement(
      "button",
      {
        className: cls("vg-seg-btn", view === "structure" && "on"),
        onClick: () => setView("structure")
      },
      "By structure"
    ))), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, view === "structure" ? `${acctLabel} \xB7 option strategies grouped by geometry \xB7 marks live` : `${acctLabel} \xB7 ${groups.length} ticker${groups.length === 1 ? "" : "s"}${analysis ? ` \xB7 ${actionable} actionable` : ""} \xB7 grouped by symbol \xB7 click to expand`), view === "structure" && /* @__PURE__ */ React.createElement(StrategiesSection, { accountId }), view === "underlying" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { gap: 8, flexWrap: "wrap", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, [["all", "All"], ["equity", "Has equity"], ["option", "Has options"], ["losers", "Losers"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: cls("vg-pill", kindFilter === k && "sel"), onClick: () => setKindFilter(k) }, l))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("select", { className: "vg-select", value: recFilter, onChange: (e) => setRecFilter(e.target.value), title: "Filter by recommendation" }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "Any recommendation"), /* @__PURE__ */ React.createElement("option", { value: "actionable" }, "Actionable only"), /* @__PURE__ */ React.createElement("option", { value: "HOLD_AND_SELL_CALL" }, "Hold & sell call"), /* @__PURE__ */ React.createElement("option", { value: "CLOSE_AND_BOOK_LOSS" }, "Close & book loss"), /* @__PURE__ */ React.createElement("option", { value: "MONITOR" }, "Monitor")), /* @__PURE__ */ React.createElement("select", { className: "vg-select", value: sortKey, onChange: (e) => setSortKey(e.target.value), title: "Sort by" }, Object.entries(HOLD_SORTS).map(([k, s]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, "Sort: ", s.label))), /* @__PURE__ */ React.createElement("input", { className: "vg-input", placeholder: "Search symbol\u2026", value: query, onChange: (e) => setQuery(e.target.value), style: { width: 130 } }))), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Symbol"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Value"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Day"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Weight"), /* @__PURE__ */ React.createElement("th", null, "Recommendation"))), /* @__PURE__ */ React.createElement("tbody", null, groups.map((g) => {
      const isOpen = !!expanded[g.key];
      const sleeve = !!g.sleeve && !g.equity && g.options.length === 0;
      const nOpts = g.options.length;
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: g.key }, /* @__PURE__ */ React.createElement(
        "tr",
        {
          className: "click vg-grouprow",
          title: sleeve ? void 0 : `Open ${g.key} chart`,
          onClick: () => {
            if (!sleeve) openChart(g.key);
          }
        },
        /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(
          "span",
          {
            className: "vg-caret",
            title: isOpen ? "collapse" : "expand lots",
            onClick: (e) => {
              e.stopPropagation();
              setExpanded((x) => ({ ...x, [g.key]: !x[g.key] }));
            }
          },
          isOpen ? "\u25BE" : "\u25B8"
        ), /* @__PURE__ */ React.createElement("b", null, g.key), nOpts > 0 && /* @__PURE__ */ React.createElement("span", { className: "vg-chip", style: { marginLeft: 6 }, title: `${nOpts} option leg(s)` }, nOpts, " OPT"), g.equity && g.equity.overlap && accountId === "all" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info", style: { marginLeft: 6 }, title: `Held as ${g.equity.overlap.symbols.join(", ")}` }, "Overlap"), g.equity && g.equity.weight > 7 && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn", style: { marginLeft: 6 } }, "Concentrated"), sleeve && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "sleeve \u2014 value via broker portfolio")),
        /* @__PURE__ */ React.createElement("td", { className: "num" }, money(g.value, g.currency)),
        /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(g.dayPl)) }, g.dayPl ? signMoney(g.dayPl, g.currency) : "\u2014"),
        /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(g.unrl)) }, signMoney(g.unrl, g.currency)),
        /* @__PURE__ */ React.createElement("td", { className: "num" }, g.weight.toFixed(1), "%"),
        /* @__PURE__ */ React.createElement("td", null, sleeve ? /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014") : /* @__PURE__ */ React.createElement(HoldingRec, { d: g._rec, onOpen: openChart }))
      ), isOpen && g.equity && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow vg-subhead" }, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { paddingLeft: 26 } }, "Equity \xB7 ", g.equity.shares, " sh")), g.equity.lots.map((l, i) => /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow", key: `eq-${i}` }, /* @__PURE__ */ React.createElement("td", { style: { paddingLeft: 34 } }, "lot \xB7 ", fmtDate(l.date)), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(lotValue(l))), /* @__PURE__ */ React.createElement("td", { className: "num" }, `${l.shares} sh @ ${usd(l.costPerShare, 2)}`), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(lotUnrl(l))) }, signUsd(lotUnrl(l))), /* @__PURE__ */ React.createElement("td", { className: "num", colSpan: 2 }, daysAgo(l.date) > 365 ? "long-term" : "short-term")))), isOpen && nOpts > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow vg-subhead" }, /* @__PURE__ */ React.createElement("td", { colSpan: 6, style: { paddingLeft: 26 } }, "Options \xB7 ", nOpts, " leg(s)")), g.options.map((p) => {
        const a = g._legActs[p.symbol.toUpperCase()] || g._legActs[optionMatchKey(p.symbol)] || null;
        return /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow vg-legrow", key: p.symbol }, /* @__PURE__ */ React.createElement("td", { style: { paddingLeft: 34 } }, optionLegLabel(p.symbol)), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(p.value)), /* @__PURE__ */ React.createElement("td", { className: "num" }, "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(p.unrl)) }, signUsd(p.unrl)), /* @__PURE__ */ React.createElement("td", { className: "num" }), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(LegActionChip, { a })));
      })));
    }), groups.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, className: "vg-note", style: { padding: 16 } }, "No holdings match the current filters.")))))));
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
    const [kind, setKind] = useState17("all");
    const [shown, setShown] = useState17(ACTIVITY_PAGE);
    const rows = useLive(
      () => getHistory(accountId).then(mapHistory),
      null,
      [accountId, settings, refreshNonce]
    ).data;
    useEffect14(() => {
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
      fontSize: 13,
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
      return /* @__PURE__ */ React.createElement("tr", { key: i, style: r.state === "cancelled" ? { opacity: 0.55 } : void 0 }, /* @__PURE__ */ React.createElement("td", null, w.day, w.time && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, w.time)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, acctOf(r.account).short)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, r.symbol || "\u2014"), r.kind === "option" && /* @__PURE__ */ React.createElement("span", { className: "vg-chip", style: { marginLeft: 6 }, title: "option contract" }, "OPT"), r.description && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, r.description)), /* @__PURE__ */ React.createElement("td", null, r.side === "buy" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "Buy"), r.side === "sell" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "Sell"), r.side !== "buy" && r.side !== "sell" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.qty != null ? r.qty : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.price != null ? usd(r.price, 2) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(r.amount || 0)) }, r.amount != null ? signedAmt(r.amount) : "\u2014"), /* @__PURE__ */ React.createElement("td", null, r.state === "filled" && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "filled"), r.state === "open" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "open"), r.state === "cancelled" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "cancelled"), r.state && !["filled", "open", "cancelled"].includes(r.state) && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, r.state), !r.state && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")));
    })))), filtered.length > shown && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setShown(shown + ACTIVITY_PAGE) }, "Show ", Math.min(ACTIVITY_PAGE, filtered.length - shown), " more \xB7 ", filtered.length - shown, " remaining"))));
  }
  function RealizedGainsCard({ accountId }) {
    const g = useLive(() => taxGains(accountId || "all"), null, [accountId]).data;
    if (!g) return null;
    const st = g.short_term || {}, lt = g.long_term || {}, cu = g.cost_unknown || {};
    return /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-pf-card", style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-pf-head" }, /* @__PURE__ */ React.createElement("span", { className: "vg-pf-title" }, "Realized gains \xB7 ", g.year), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", g.total_gain >= 0 ? "good" : "bad") }, signUsd(g.total_gain))), /* @__PURE__ */ React.createElement("div", { className: "vg-pf-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Short-term", value: signUsd(st.gain), deltaDir: dirCls(st.gain), note: `${st.n || 0} lots \xB7 taxed as income` }), /* @__PURE__ */ React.createElement(StatTile, { label: "Long-term", value: signUsd(lt.gain), deltaDir: dirCls(lt.gain), note: `${lt.n || 0} lots \xB7 held >1yr` }), /* @__PURE__ */ React.createElement(StatTile, { label: "Est. tax owed", value: usd(g.estimated_tax), note: `${Math.round((g.st_rate || 0) * 100)}% ST / ${Math.round((g.lt_rate || 0) * 100)}% LT` })), cu.proceeds > 0 && /* @__PURE__ */ React.createElement("p", { className: "vg-note vg-pf-note" }, usd(cu.proceeds), " of sells have no imported buy history \u2014 cost basis unknown, gain not computed (", (cu.rows || []).map((r) => r.symbol).slice(0, 6).join(", "), ")."));
  }
  function TaxView({ settings, tlh: tlh2, accountId }) {
    const [washFaqOpen, setWashFaqOpen] = useState17(false);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Tax Center \u2014 realized gains & loss harvesting"), /* @__PURE__ */ React.createElement(RealizedGainsCard, { accountId }), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Every lot marked to last close \xB7 wash-sale window checked across ", /* @__PURE__ */ React.createElement("b", null, "all linked accounts"), " \xB7 threshold ", usd(settings.thresholdUsd), " or ", settings.thresholdPct, "% \xB7 decision-support only, no orders placed"), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Lot"), /* @__PURE__ */ React.createElement("th", null, "Account"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", null, "Status"), /* @__PURE__ */ React.createElement("th", null, "Action"))), /* @__PURE__ */ React.createElement("tbody", null, tlh2.map((c, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, c.lot.symbol), " \xB7 ", c.lot.shares, " sh @ ", usd(c.lot.costPerShare, 2), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "bought ", fmtDate(c.lot.date))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, c.acct.short)), /* @__PURE__ */ React.createElement("td", { className: "num down" }, signUsd(c.unrl), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", signPct(-c.lossPct), ")")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u2713 Clear to harvest"), c.status === "blocked" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Wash-sale blocked"), c.status === "below" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "Below threshold"), c.status === "na" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "N/A \u2014 tax-advantaged"), c.status === "blocked" && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { maxWidth: 320, marginTop: 4 } }, c.wash.reason, ". Clears ", c.wash.clearsOn === "auto-buy paused" ? "once the auto-buy is paused" : c.wash.clearsOn, ".")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && (c.replacement ? /* @__PURE__ */ React.createElement("span", null, "Sell \u2192 buy ", /* @__PURE__ */ React.createElement("b", null, c.replacement), " ", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "different index, near-identical exposure")) : /* @__PURE__ */ React.createElement("span", null, "Sell, wait 31 days to rebuy", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "no like-exposure partner for single stock"))), c.status === "blocked" && c.wash.futureRisk && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Pause ", c.wash.futureRisk.symbol, " auto-buy to open a window"), (c.status === "below" || c.status === "na") && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Monitor"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement(
      FAQItem,
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
    const [open, setOpen] = useState17(false);
    const conv = CONVICTION_CHIP[d.conviction.label] || CONVICTION_CHIP.neutral;
    const rec = REC_CHIP[d.recommendation] || { cls: "plain", text: d.recommendation };
    const ev = d.evidence || {};
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("tr", { className: "vg-recrow", style: { cursor: "pointer" } }, /* @__PURE__ */ React.createElement("td", { onClick: () => onJump(d.symbol) }, /* @__PURE__ */ React.createElement("b", null, d.symbol)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", conv.cls) }, conv.text)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", rec.cls) }, rec.text)), /* @__PURE__ */ React.createElement("td", { style: { fontSize: 14 } }, recDetail(d)), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setOpen(!open) }, open ? "hide" : "evidence"), " \xB7 ", /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => onJump(d.symbol) }, "chart \u2192"))), open && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 5, style: { background: "var(--color-light)", padding: "12px 14px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, lineHeight: 1.6 } }, /* @__PURE__ */ React.createElement("p", { style: { margin: "0 0 8px" } }, d.rationale), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 18, flexWrap: "wrap", color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, tfTrend(ev.perTf, "daily")), /* @__PURE__ */ React.createElement("span", null, tfTrend(ev.perTf, "weekly")), /* @__PURE__ */ React.createElement("span", null, tfTrend(ev.perTf, "monthly"))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 18, flexWrap: "wrap", marginTop: 6, color: "var(--color-grey)" } }, ev.nearestSupport && /* @__PURE__ */ React.createElement("span", null, "nearest support ", Number(ev.nearestSupport.price).toFixed(2), " (str ", ev.nearestSupport.strength, ")"), ev.nearestResistance && /* @__PURE__ */ React.createElement("span", null, "nearest resistance ", Number(ev.nearestResistance.price).toFixed(2), " (str ", ev.nearestResistance.strength, ")"), /* @__PURE__ */ React.createElement("span", null, "broke support w/ momentum: ", ev.brokeSupportWithMomentum ? "yes" : "no"), /* @__PURE__ */ React.createElement("span", null, "rule: ", d.rule))))));
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
      const u = underlyingOf(sym);
      setSymbol(u);
      go("ic", u);
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Recommendations"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Persisted decision journal", data && data.asOf ? ` \xB7 as of ${data.asOf}` : "", " \xB7 actionable first \xB7 educational only, not advice"), sorted.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No analysis available"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, "The decision journal is empty or the backend is unreachable. Run the nightly analysis (", /* @__PURE__ */ React.createElement("code", null, "python -m vantage_server.analyze"), ") and confirm the backend URL in Settings.")) : /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8, padding: 0, overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 13, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Symbol"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Conviction"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Recommendation"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Detail"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px", textAlign: "right" } }))), /* @__PURE__ */ React.createElement("tbody", null, sorted.map((d) => /* @__PURE__ */ React.createElement(RecRow2, { key: d.symbol, d, onJump: jump }))))));
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
    const [msgs, setMsgs] = useState17([
      { who: "ai", text: "Hi \u2014 I'm Vantage AI. I can see across all 4 of your linked accounts. Ask me about harvesting, wash sales, overlap, or your allocation." }
    ]);
    const [draft, setDraft] = useState17("");
    const [busy, setBusy] = useState17(false);
    const bodyRef = useRef6(null);
    const abortRef = useRef6(null);
    useEffect14(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs]);
    useEffect14(() => () => {
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
    const inner = /* @__PURE__ */ React.createElement(React.Fragment, null, !docked && /* @__PURE__ */ React.createElement("div", { className: "vg-panel-head" }, /* @__PURE__ */ React.createElement("h3", null, "Vantage AI"), /* @__PURE__ */ React.createElement("button", { className: "vg-x", "aria-label": "Close", onClick: onClose }, "\xD7")), /* @__PURE__ */ React.createElement("div", { className: "vg-panel-body", ref: bodyRef }, msgs.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: cls("vg-msg", m.who) }, m.plan && m.plan.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, opacity: 0.65, marginBottom: 6 } }, m.plan.map((s, j) => /* @__PURE__ */ React.createElement("div", { key: j }, "\xB7 ", s))), m.who === "ai" && !m.pending && m.text ? /* @__PURE__ */ React.createElement(MiraRender, { text: m.text }) : m.text || (m.pending ? "\u2026" : ""), m.offline && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 6 } }, "offline \u2014 canned reply"), m.who === "ai" && m.corr && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", style: { fontSize: 12 }, onClick: () => toggleExplain(i) }, m.explainOpen ? "hide explanation" : "explain"), m.explainOpen && /* @__PURE__ */ React.createElement(ExplainBlock, { explain: m.explain }))))), /* @__PURE__ */ React.createElement("div", { className: "vg-chatform" }, /* @__PURE__ */ React.createElement(
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
    return /* @__PURE__ */ React.createElement("div", { style: { marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--color-border)", fontSize: 13, lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { fontSize: 12, marginBottom: 4 } }, ratio != null && /* @__PURE__ */ React.createElement(React.Fragment, null, "grounded ", Math.round(ratio * 100), "% \xB7 "), steps, " plan step", steps === 1 ? "" : "s", " \xB7 ", claims.length, " claim", claims.length === 1 ? "" : "s"), claims.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i }, "\xB7 ", c.statement, " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", c.source_type, ":", c.source_id, ")"))));
  }
  function AccountsSettings() {
    const live_ = live_exports;
    const [rows, setRows] = useState17(null);
    const [busy, setBusy] = useState17("");
    const [err, setErr] = useState17("");
    const [adding, setAdding] = useState17(false);
    const [editId, setEditId] = useState17(null);
    const blank = { id: "", name: "", currency: "USD", jurisdiction: "US", taxable: true, broker: "" };
    const [form, setForm] = useState17(blank);
    const load = async () => {
      try {
        const p = await live_.accounts();
        setRows(p && p.accounts || []);
      } catch {
        setRows([]);
      }
    };
    useEffect14(() => {
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
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", fontSize: 14 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "Account"), /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "Broker"), /* @__PURE__ */ React.createElement("th", null, "Ccy"), /* @__PURE__ */ React.createElement("th", null, "Juris."), /* @__PURE__ */ React.createElement("th", { style: { textAlign: "left" } }, "Status"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((a) => /* @__PURE__ */ React.createElement("tr", { key: a.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, a.short || a.id), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, a.id)), /* @__PURE__ */ React.createElement("td", null, a.broker || /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "manual")), /* @__PURE__ */ React.createElement("td", { className: "num" }, a.currency || "USD"), /* @__PURE__ */ React.createElement("td", { className: "num" }, a.jurisdiction || "US"), /* @__PURE__ */ React.createElement("td", null, a.auth_status ? /* @__PURE__ */ React.createElement("span", { className: authOk(a.auth_status) ? "vg-pos" : "vg-neg" }, a.auth_status) : /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { style: { textAlign: "right", whiteSpace: "nowrap" } }, a.broker === "zerodha" && /* @__PURE__ */ React.createElement(
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
    )))), rows.length === 0 && /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { colSpan: 6, className: "vg-note" }, "No accounts yet.")))), rows.some((a) => a.auth_hint) && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 8, fontSize: 13 } }, "API brokers need a one-time host-side auth (your secret never enters the browser). Run:", /* @__PURE__ */ React.createElement("ul", { style: { margin: "4px 0 0 0", paddingLeft: 18 } }, [...new Set(rows.filter((a) => a.auth_hint).map((a) => a.auth_hint))].map((h) => /* @__PURE__ */ React.createElement("li", { key: h }, /* @__PURE__ */ React.createElement("code", { style: { fontSize: 12 } }, h))))), !adding && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(Button, { variant: "outline", onClick: startAdd }, "+ Add account")), adding && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, padding: 12, border: "1px solid var(--border, #ddd)", borderRadius: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, editId ? `Edit ${editId}` : "New account"), !editId && /* @__PURE__ */ React.createElement(
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
    ), " Taxable account"), err && /* @__PURE__ */ React.createElement("div", { className: "vg-neg", style: { fontSize: 13, marginBottom: 8 } }, err), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { justifyContent: "flex-end", gap: 8 } }, /* @__PURE__ */ React.createElement(Button, { variant: "outline", onClick: () => setAdding(false) }, "Cancel"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", disabled: busy === "save", onClick: save }, busy === "save" ? "Saving\u2026" : editId ? "Save changes" : "Create account"))), err && !adding && /* @__PURE__ */ React.createElement("div", { className: "vg-neg", style: { fontSize: 13, marginTop: 8 } }, err));
  }
  function SettingsModal({ settings, accounts: accounts2 = [], onSave, onClose }) {
    const [draft, setDraft] = useState17(settings);
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
