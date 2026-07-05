(() => {
  // src/data.js
  var TODAY = /* @__PURE__ */ new Date("2026-07-05T09:30:00-04:00");
  var ACCOUNTS = [
    { id: "fid-taxable", name: "Fidelity Individual", short: "Fidelity", type: "Taxable", taxable: true, lastSync: "8:30 AM" },
    { id: "schwab-roth", name: "Schwab Roth IRA", short: "Roth IRA", type: "Roth IRA", taxable: false, lastSync: "8:30 AM" },
    { id: "vg-401k", name: "Vanguard 401(k)", short: "401(k)", type: "401(k)", taxable: false, lastSync: "Yesterday" },
    { id: "wf-robo", name: "Wealthfront Automated", short: "Robo", type: "Taxable \xB7 Robo", taxable: true, lastSync: "8:31 AM" }
  ];
  var MARKET = {
    VOO: { name: "Vanguard S&P 500 ETF", price: 683.2, dayPct: -0.12, assetClass: "usEquity" },
    SPY: { name: "SPDR S&P 500 ETF", price: 744.78, dayPct: -0.13, assetClass: "usEquity" },
    VTI: { name: "Vanguard Total Market ETF", price: 330.45, dayPct: -0.1, assetClass: "usEquity" },
    QQQ: { name: "Invesco Nasdaq-100 ETF", price: 625.4, dayPct: 0.21, assetClass: "usEquity" },
    SCHG: { name: "Schwab US Large Growth ETF", price: 32.05, dayPct: 0.18, assetClass: "usEquity" },
    IWM: { name: "iShares Russell 2000 ETF", price: 297.58, dayPct: -0.58, assetClass: "usEquity" },
    IJR: { name: "iShares S&P SmallCap 600", price: 130.22, dayPct: -0.44, assetClass: "usEquity" },
    NVDA: { name: "NVIDIA Corp", price: 194.83, dayPct: -1.39, assetClass: "usEquity" },
    AAPL: { name: "Apple Inc", price: 308.63, dayPct: 0.84, assetClass: "usEquity" },
    TSLA: { name: "Tesla Inc", price: 393.45, dayPct: -2.49, assetClass: "usEquity" },
    BND: { name: "Vanguard Total Bond ETF", price: 74.2, dayPct: 0.05, assetClass: "bonds" },
    VXUS: { name: "Vanguard Total Intl ETF", price: 71.5, dayPct: 0.32, assetClass: "intlEquity" },
    CASH: { name: "Cash & sweep", price: 1, dayPct: 0, assetClass: "cash" }
  };
  var LOTS = [
    { account: "fid-taxable", symbol: "VOO", date: "2025-11-03", shares: 40, costPerShare: 640 },
    { account: "fid-taxable", symbol: "VOO", date: "2026-05-28", shares: 12, costPerShare: 705.5 },
    { account: "fid-taxable", symbol: "NVDA", date: "2025-08-15", shares: 60, costPerShare: 121.4 },
    { account: "fid-taxable", symbol: "IWM", date: "2026-02-12", shares: 45, costPerShare: 331.2 },
    { account: "fid-taxable", symbol: "AAPL", date: "2025-12-01", shares: 25, costPerShare: 289.1 },
    { account: "fid-taxable", symbol: "BND", date: "2026-03-17", shares: 120, costPerShare: 75.6 },
    { account: "fid-taxable", symbol: "CASH", date: "2026-07-01", shares: 6400, costPerShare: 1 },
    { account: "schwab-roth", symbol: "QQQ", date: "2026-01-20", shares: 30, costPerShare: 598.2 },
    { account: "schwab-roth", symbol: "SPY", date: "2026-02-03", shares: 18, costPerShare: 731.4 },
    { account: "schwab-roth", symbol: "VXUS", date: "2025-10-09", shares: 150, costPerShare: 68.9 },
    { account: "schwab-roth", symbol: "CASH", date: "2026-07-01", shares: 1200, costPerShare: 1 },
    { account: "vg-401k", symbol: "VTI", date: "2025-06-30", shares: 180, costPerShare: 302.5 },
    { account: "vg-401k", symbol: "SCHG", date: "2025-09-12", shares: 210, costPerShare: 29.4 },
    { account: "vg-401k", symbol: "BND", date: "2026-04-02", shares: 300, costPerShare: 76.8 },
    { account: "wf-robo", symbol: "VOO", date: "2026-04-01", shares: 8.4, costPerShare: 668.3 },
    { account: "wf-robo", symbol: "VTI", date: "2025-11-20", shares: 22, costPerShare: 315.9 },
    { account: "wf-robo", symbol: "TSLA", date: "2026-04-10", shares: 6, costPerShare: 441.7 },
    { account: "wf-robo", symbol: "CASH", date: "2026-07-01", shares: 2900, costPerShare: 1 }
  ];
  var RECENT_BUYS = [
    { account: "wf-robo", symbol: "VOO", date: "2026-07-01", note: "monthly auto-invest $500" },
    { account: "schwab-roth", symbol: "QQQ", date: "2026-06-18", note: "dividend reinvestment" },
    { account: "vg-401k", symbol: "VTI", date: "2026-06-30", note: "payroll contribution" }
  ];
  var AUTO_BUYS = [
    { account: "wf-robo", symbol: "VOO", dayOfMonth: 1, amount: 500 },
    { account: "vg-401k", symbol: "VTI", cadence: "biweekly payroll" }
  ];
  var PARTNER_MAP = {
    VOO: "VTI",
    SPY: "VTI",
    IVV: "VTI",
    QQQM: "SCHG",
    QQQ: "SCHG",
    IJR: "VB",
    IWM: "IJR",
    VTI: "VOO",
    VB: "IJR",
    SCHG: "VUG"
  };
  var WASH_FAMILIES = [
    ["VOO", "SPY", "IVV"],
    // same index: S&P 500
    ["QQQ", "QQQM"]
    // same index: Nasdaq-100
  ];
  var OVERLAP_GROUPS = [
    { label: "US large blend", symbols: ["VOO", "SPY", "VTI", "IVV"] },
    { label: "US large growth", symbols: ["QQQ", "QQQM", "SCHG"] },
    { label: "US small cap", symbols: ["IWM", "IJR", "VB"] }
  ];
  var WASH_WINDOW_DAYS = 30;
  var TICKER_STRIP = [
    { sym: "SPY", label: "SPY", price: "744.78", pct: -0.13 },
    { sym: "QQQ", label: "QQQ", price: "625.40", pct: 0.21 },
    { sym: "IWM", label: "IWM", price: "297.58", pct: -0.58 },
    { sym: "VIX", label: "VIX", price: "15.81", pct: 2.11 },
    { sym: "TLT", label: "TLT", price: "85.51", pct: 0.01 },
    { sym: "GLD", label: "GLD", price: "378.13", pct: 2.03 },
    { sym: "BTC", label: "BTC-USD", price: "62,648", pct: -0.7 },
    { sym: "OIL", label: "WTI", price: "68.78", pct: 0.13 }
  ];
  var AI_INSIGHTS = {
    SPY: {
      bias: "Neutral",
      momentum: 42,
      sentiment: 48,
      summary: "Market trend is mildly bearish but momentum lacks conviction. Breadth is thin and leadership is rotating out of megacap tech. Avoid new long entries until stabilization; support sits near 738, resistance 752."
    },
    QQQ: {
      bias: "Bullish",
      momentum: 63,
      sentiment: 61,
      summary: "Growth is holding its uptrend on improving volume. A close above 628 opens the prior high; risk is defined below the 20-day at 612."
    },
    NVDA: {
      bias: "Bearish",
      momentum: 31,
      sentiment: 39,
      summary: "Distribution days are stacking up and relative strength has rolled over. Below 190 the next demand zone is 178\u2013182. Wait for a base before adding."
    },
    TSLA: {
      bias: "Bearish",
      momentum: 24,
      sentiment: 33,
      summary: "Breakdown from the April range is still working lower on elevated volume. No edge on the long side until a reclaim of 410."
    },
    AAPL: {
      bias: "Bullish",
      momentum: 71,
      sentiment: 66,
      summary: "Strong accumulation into product-cycle expectations. Pullbacks toward 300 have been bought; momentum favors continuation while above 296."
    },
    MSFT: {
      bias: "Neutral",
      momentum: 50,
      sentiment: 52,
      summary: "Consolidating in a tight multi-week range. Coiled setup: watch a break of 396 up or 384 down for direction."
    }
  };
  var AI_PICKS = [
    { sym: "AAPL", stance: "Bullish", conf: 78, note: "Accumulation trend, product-cycle tailwind" },
    { sym: "QQQ", stance: "Bullish", conf: 72, note: "Uptrend intact above the 20-day" },
    { sym: "SPY", stance: "Neutral", conf: 60, note: "Chop zone 738\u2013752, no edge" },
    { sym: "NVDA", stance: "Bearish", conf: 67, note: "Relative strength rolling over" },
    { sym: "TSLA", stance: "Bearish", conf: 70, note: "Range breakdown still working" }
  ];
  var SIGNALS = [
    { id: 1, sym: "PLTR", pattern: "Cup & Handle", entry: 168.4, target: 177.2, stop: 163.9, movePct: 5.2, conf: 89, time: "09:41", status: "active" },
    { id: 2, sym: "SMCI", pattern: "Ascending Triangle", entry: 54.1, target: 56.7, stop: 52.6, movePct: 4.8, conf: 87, time: "09:37", status: "active" },
    { id: 3, sym: "SOFI", pattern: "Flag Breakout", entry: 21.35, target: 22.2, stop: 20.8, movePct: 4.1, conf: 85, time: "09:35", status: "active" },
    { id: 4, sym: "RKLB", pattern: "Wedge Breakout", entry: 38.9, target: 40.6, stop: 37.8, movePct: 4.3, conf: 83, time: "09:33", status: "active" },
    { id: 5, sym: "HOOD", pattern: "Double Bottom", entry: 42.15, target: 43.8, stop: 41.1, movePct: 3.9, conf: 82, time: "09:30", status: "active" },
    { id: 6, sym: "AMD", pattern: "Bear Put Spread", entry: 148.2, target: 141, stop: 152.4, movePct: -4.9, conf: 82, time: "Jul 2", status: "hit-target" },
    { id: 7, sym: "GOOGL", pattern: "Call Ladder", entry: 231.1, target: 239.5, stop: 226, movePct: 3.6, conf: 84, time: "Jul 1", status: "hit-target" },
    { id: 8, sym: "META", pattern: "Breakout Retest", entry: 588, target: 610, stop: 574, movePct: 3.7, conf: 76, time: "Jun 30", status: "stopped" }
  ];
  var SECTORS = [
    { name: "Technology", pct: -0.73, stocks: [
      { sym: "NVDA", pct: -1.39 },
      { sym: "AAPL", pct: 0.84 },
      { sym: "MSFT", pct: 0.62 },
      { sym: "AVGO", pct: -2.41 },
      { sym: "AMD", pct: -4.26 },
      { sym: "ORCL", pct: -1.56 }
    ] },
    { name: "Comm. Services", pct: 1.01, stocks: [
      { sym: "GOOGL", pct: -0.36 },
      { sym: "META", pct: -1.9 },
      { sym: "NFLX", pct: 4.66 },
      { sym: "DIS", pct: 3.96 },
      { sym: "TMUS", pct: 2.58 },
      { sym: "T", pct: 0.49 }
    ] },
    { name: "Consumer Disc.", pct: 0.74, stocks: [
      { sym: "AMZN", pct: 0.4 },
      { sym: "TSLA", pct: -2.49 },
      { sym: "HD", pct: 2.01 },
      { sym: "MCD", pct: 4.16 },
      { sym: "NKE", pct: 2.39 },
      { sym: "SBUX", pct: 0.85 }
    ] },
    { name: "Financials", pct: 1.1, stocks: [
      { sym: "BRK.B", pct: 1.61 },
      { sym: "JPM", pct: 0.12 },
      { sym: "V", pct: 3.15 },
      { sym: "MA", pct: 3.24 },
      { sym: "BAC", pct: 0.63 },
      { sym: "GS", pct: 0.14 }
    ] },
    { name: "Healthcare", pct: 3.29, stocks: [
      { sym: "LLY", pct: 1.86 },
      { sym: "UNH", pct: -0.28 },
      { sym: "JNJ", pct: 3.57 },
      { sym: "ABBV", pct: 3.99 },
      { sym: "MRK", pct: 3.34 },
      { sym: "AMGN", pct: 3.55 }
    ] },
    { name: "Industrials", pct: 1.7, stocks: [
      { sym: "GE", pct: 0.69 },
      { sym: "RTX", pct: 3.9 },
      { sym: "CAT", pct: -2.81 },
      { sym: "HON", pct: 3.66 },
      { sym: "LMT", pct: 4.62 },
      { sym: "DE", pct: -1.01 }
    ] },
    { name: "Consumer Staples", pct: 2.77, stocks: [
      { sym: "WMT", pct: 2.78 },
      { sym: "PG", pct: 2.7 },
      { sym: "COST", pct: 2.92 },
      { sym: "KO", pct: 3.51 },
      { sym: "PEP", pct: 2.17 },
      { sym: "PM", pct: 2.58 }
    ] },
    { name: "Energy", pct: 1.19, stocks: [
      { sym: "XOM", pct: 0.59 },
      { sym: "CVX", pct: 2.12 },
      { sym: "COP", pct: 1.46 },
      { sym: "SLB", pct: 0.09 },
      { sym: "EOG", pct: 1.7 }
    ] },
    { name: "Real Estate", pct: 0.53, stocks: [
      { sym: "AMT", pct: -0.03 },
      { sym: "EQIX", pct: -1.14 },
      { sym: "PLD", pct: 1.92 },
      { sym: "SPG", pct: 1.37 }
    ] },
    { name: "Materials", pct: 1.9, stocks: [
      { sym: "LIN", pct: 2.45 },
      { sym: "SHW", pct: 1.86 },
      { sym: "APD", pct: 2.54 },
      { sym: "FCX", pct: 0.73 }
    ] },
    { name: "Utilities", pct: 2.78, stocks: [
      { sym: "NEE", pct: 2.28 },
      { sym: "SO", pct: 3.01 },
      { sym: "DUK", pct: 3.05 }
    ] }
  ];
  var NOTIFICATIONS_SEED = [
    { id: 1, type: "tlh", title: "TLH opportunity: IWM", body: "Fidelity lot from Feb 12 is $1,513 underwater \u2014 past your $200 harvest threshold. Suggested replacement: IJR.", time: "8:32 AM", read: false },
    { id: 2, type: "wash", title: "Wash-sale risk: VOO", body: "Harvesting the Fidelity VOO loss is blocked \u2014 Wealthfront auto-bought VOO on Jul 1. Window clears Jul 31.", time: "8:32 AM", read: false },
    { id: 3, type: "drift", title: "Allocation drift +4.2%", body: "US equity is 4.2% above your 70% target across all accounts. Consider directing new contributions to bonds.", time: "8:30 AM", read: false },
    { id: 4, type: "price", title: "NVDA down 1.4% premarket", body: "NVDA is your largest single-stock position (7.9% of portfolio). AI bias flipped to Bearish.", time: "7:55 AM", read: true },
    { id: 5, type: "tlh", title: "TSLA loss past threshold", body: "Wealthfront TSLA lot is $290 underwater. No recent buys detected in any account \u2014 clear to harvest.", time: "Yesterday", read: true },
    { id: 6, type: "system", title: "Vanguard 401(k) synced", body: "Holdings refreshed. Payroll contribution of $730 landed in VTI on Jun 30.", time: "Yesterday", read: true },
    { id: 7, type: "price", title: "AAPL new 3-month high", body: "AAPL closed above 308. Held in Fidelity Individual (25 sh).", time: "Jul 2", read: true },
    { id: 8, type: "drift", title: "Cash drag: $10,500 idle", body: "Combined sweep cash is earning ~0.4%. A money-market fund would add \u2248 $430/yr at current rates.", time: "Jul 1", read: true }
  ];
  var NOTIF_TYPES = {
    tlh: { label: "Tax-loss harvesting", accent: "teal", icon: "\u{1F33E}" },
    wash: { label: "Wash-sale warnings", accent: "orange", icon: "\u26A0\uFE0F" },
    price: { label: "Price & AI alerts", accent: "blue", icon: "\u{1F4C8}" },
    drift: { label: "Allocation drift", accent: "purple", icon: "\u2696\uFE0F" },
    system: { label: "Account sync", accent: "cyan", icon: "\u{1F504}" }
  };
  var CHAT_RULES = [
    { match: /wash|blocked/i, reply: "Your VOO harvest is blocked because Wealthfront's auto-invest bought VOO on Jul 1 \u2014 a purchase of a substantially identical security in ANY of your accounts (even an IRA) restarts the 30-day wash-sale clock. Options: pause the Jul auto-buy and harvest after Jul 31, or harvest into VTI now from the Fidelity side only if you also skip the August auto-buy." },
    { match: /tlh|harvest|tax/i, reply: "Across your 4 accounts I see two clean harvest candidates today: IWM in Fidelity (\u2212$1,513, replace with IJR) and TSLA in Wealthfront (\u2212$290, no replacement pair \u2014 wait 31 days to rebuy). Combined estimated after-tax benefit \u2248 $433 at your 24% marginal rate. VOO is also underwater but wash-blocked until Jul 31." },
    { match: /overlap|duplicate|consolidat/i, reply: "You hold the same US large-blend exposure in three places: VOO (Fidelity + Wealthfront), SPY (Roth), and VTI (401(k) + Wealthfront) \u2014 together 54% of your portfolio. That's fine for tax-lot flexibility, but it makes rebalancing noisy. Consider standardizing on one fund per account going forward." },
    { match: /alloc|balance|drift/i, reply: "Consolidated allocation: 78% US equity, 7% international, 9% bonds, 6% cash \u2014 vs your 70/10/15/5 target. You're overweight US equity by ~8 points. Cheapest fix: direct new 401(k) contributions to BND rather than selling (no tax cost)." },
    { match: /nvda|nvidia/i, reply: "NVDA is 7.9% of your combined portfolio \u2014 your largest single-stock bet, all in the Fidelity taxable account with a $4,406 unrealized gain (long-term as of Aug 15). AI bias just flipped Bearish. If you trim, the long-term rate applies after Aug 15 \u2014 worth waiting 6 weeks if you can tolerate the drawdown." },
    { match: /.*/, reply: "I can help with anything across your linked accounts \u2014 try asking about tax-loss harvesting, wash-sale status, overlap between accounts, allocation drift, or any position you hold. (Demo assistant: canned responses, educational only.)" }
  ];
  var ALLOCATION_TARGETS = { usEquity: 70, intlEquity: 10, bonds: 15, cash: 5 };
  var ASSET_CLASSES = {
    usEquity: { label: "US Equity", color: "#2e68fd" },
    intlEquity: { label: "International", color: "#0d9488" },
    bonds: { label: "Bonds", color: "#932cfa" },
    cash: { label: "Cash", color: "#ca8a04" }
  };

  // src/app.jsx
  var { useState, useMemo, useEffect, useRef } = React;
  var { Navbar, Button, Modal, FormField, SecurityCard, FAQItem } = window.LookeyDS;
  var usd = (n, digits = 0) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  var signUsd = (n) => `${n >= 0 ? "+" : "\u2212"}${usd(Math.abs(n))}`;
  var signPct = (n, d = 2) => `${n >= 0 ? "+" : "\u2212"}${Math.abs(n).toFixed(d)}%`;
  var cls = (...xs) => xs.filter(Boolean).join(" ");
  var dirCls = (n) => n > 0 ? "up" : n < 0 ? "down" : "";
  var DAY_MS = 864e5;
  var daysAgo = (iso) => Math.floor((TODAY - /* @__PURE__ */ new Date(iso + "T12:00:00")) / DAY_MS);
  var fmtDate = (iso) => (/* @__PURE__ */ new Date(iso + "T12:00:00")).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  var addDays = (iso, n) => {
    const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var lotValue = (l) => l.shares * MARKET[l.symbol].price;
  var lotCost = (l) => l.shares * l.costPerShare;
  var lotUnrl = (l) => lotValue(l) - lotCost(l);
  function washFamily(sym) {
    const fam = WASH_FAMILIES.find((f) => f.includes(sym));
    return fam ? fam : [sym];
  }
  function washStatus(sym) {
    const fam = washFamily(sym);
    const past = RECENT_BUYS.find((b) => fam.includes(b.symbol) && daysAgo(b.date) <= WASH_WINDOW_DAYS);
    if (past) {
      const acct = ACCOUNTS.find((a) => a.id === past.account);
      return {
        blocked: true,
        reason: `${acct.short} bought ${past.symbol} on ${fmtDate(past.date)} (${past.note})`,
        clearsOn: addDays(past.date, WASH_WINDOW_DAYS + 1),
        futureRisk: AUTO_BUYS.find((ab) => fam.includes(ab.symbol))
      };
    }
    const future = AUTO_BUYS.find((ab) => fam.includes(ab.symbol) && ab.dayOfMonth != null);
    if (future) {
      const acct = ACCOUNTS.find((a) => a.id === future.account);
      return {
        blocked: true,
        reason: `${acct.short} auto-buys ${future.symbol} monthly (next: Aug ${future.dayOfMonth}) \u2014 a buy within 30 days after the sale washes it`,
        clearsOn: "auto-buy paused",
        futureRisk: future
      };
    }
    return { blocked: false };
  }
  function selectedLots(accountId) {
    return accountId === "all" ? LOTS : LOTS.filter((l) => l.account === accountId);
  }
  function positions(accountId) {
    const bySym = {};
    for (const l of selectedLots(accountId)) {
      const p = bySym[l.symbol] ||= { symbol: l.symbol, shares: 0, value: 0, cost: 0, accounts: /* @__PURE__ */ new Set(), lots: [] };
      p.shares += l.shares;
      p.value += lotValue(l);
      p.cost += lotCost(l);
      p.accounts.add(l.account);
      p.lots.push(l);
    }
    const total = Object.values(bySym).reduce((s, p) => s + p.value, 0);
    return Object.values(bySym).map((p) => ({
      ...p,
      unrl: p.value - p.cost,
      dayPl: p.value * MARKET[p.symbol].dayPct / 100,
      weight: total ? p.value / total * 100 : 0,
      overlap: overlapFor(p.symbol)
    })).sort((a, b) => b.value - a.value);
  }
  function overlapFor(sym) {
    for (const g of OVERLAP_GROUPS) {
      if (!g.symbols.includes(sym)) continue;
      const held = g.symbols.filter((s) => LOTS.some((l) => l.symbol === s));
      if (held.length >= 2) return { label: g.label, symbols: held };
    }
    return null;
  }
  function tlhCandidates(settings) {
    const out = [];
    for (const l of LOTS) {
      const acct = ACCOUNTS.find((a) => a.id === l.account);
      if (l.symbol === "CASH") continue;
      const unrl = lotUnrl(l);
      if (unrl >= 0) continue;
      const lossPct = -unrl / lotCost(l) * 100;
      const pastThreshold = -unrl >= settings.thresholdUsd || lossPct >= settings.thresholdPct;
      if (!acct.taxable) {
        out.push({ lot: l, acct, unrl, lossPct, status: "na" });
        continue;
      }
      if (!pastThreshold) {
        out.push({ lot: l, acct, unrl, lossPct, status: "below" });
        continue;
      }
      const wash = washStatus(l.symbol);
      out.push({
        lot: l,
        acct,
        unrl,
        lossPct,
        status: wash.blocked ? "blocked" : "clear",
        wash,
        replacement: PARTNER_MAP[l.symbol] || null
      });
    }
    return out.sort((a, b) => a.unrl - b.unrl);
  }
  function allocation(accountId) {
    const byClass = { usEquity: 0, intlEquity: 0, bonds: 0, cash: 0 };
    let total = 0;
    for (const l of selectedLots(accountId)) {
      const v = lotValue(l);
      byClass[MARKET[l.symbol].assetClass] += v;
      total += v;
    }
    return { byClass, total };
  }
  var accountValue = (id) => LOTS.filter((l) => l.account === id).reduce((s, l) => s + lotValue(l), 0);
  var SETTINGS_KEY = "vantage.settings.v1";
  var DEFAULT_SETTINGS = {
    defaultAccount: "all",
    thresholdUsd: 200,
    thresholdPct: 3,
    taxRate: 24,
    notifPrefs: { tlh: true, wash: true, price: true, drift: true, system: true }
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
  function heatTint(pct) {
    if (Math.abs(pct) < 0.15) return "#f1f5f9";
    const a = Math.min(0.08 + Math.abs(pct) / 5 * 0.3, 0.38);
    return pct > 0 ? `rgba(5,150,105,${a.toFixed(3)})` : `rgba(220,38,38,${a.toFixed(3)})`;
  }
  function App() {
    const [settings, setSettings] = useState(loadSettings);
    const [accountId, setAccountId] = useState(settings.defaultAccount);
    const [symbol, setSymbol] = useState("SPY");
    const [signalsTab, setSignalsTab] = useState("active");
    const [expanded, setExpanded] = useState({});
    const [notifs, setNotifs] = useState(NOTIFICATIONS_SEED);
    const [notifOpen, setNotifOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [analysisSym, setAnalysisSym] = useState(null);
    const [washFaqOpen, setWashFaqOpen] = useState(false);
    const pos = useMemo(() => positions(accountId), [accountId]);
    const alloc = useMemo(() => allocation(accountId), [accountId]);
    const tlh = useMemo(() => tlhCandidates(settings), [settings]);
    const totalValue = alloc.total;
    const dayPl = pos.reduce((s, p) => s + p.dayPl, 0);
    const unrlPl = pos.reduce((s, p) => s + p.unrl, 0);
    const harvestable = tlh.filter((c) => c.status === "clear");
    const harvestableLoss = harvestable.reduce((s, c) => s + -c.unrl, 0);
    const estBenefit = harvestableLoss * (settings.taxRate / 100);
    const unread = notifs.filter((n) => !n.read && settings.notifPrefs[n.type]).length;
    const acctLabel = accountId === "all" ? "All accounts" : ACCOUNTS.find((a) => a.id === accountId).name;
    const saveSettings = (next) => {
      setSettings(next);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (e) {
      }
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-compliance" }, "AI-generated analysis \xB7 Demo with simulated data \xB7 Educational purposes only \u2014 not financial, investment, or tax advice"), /* @__PURE__ */ React.createElement(
      Navbar,
      {
        brand: "Vant",
        brandAccent: "age",
        links: [
          { label: "Portfolio", href: "#portfolio" },
          { label: "Holdings", href: "#holdings" },
          { label: "Tax Center", href: "#tax" },
          { label: "Markets", href: "#markets" }
        ],
        cta: /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: () => setSettingsOpen(true) }, "Settings")
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-ticker" }, TICKER_STRIP.map((t) => /* @__PURE__ */ React.createElement("span", { className: "vg-tick", key: t.sym }, /* @__PURE__ */ React.createElement("b", null, t.label), " ", t.price, /* @__PURE__ */ React.createElement("span", { className: dirCls(t.pct) }, signPct(t.pct))))), /* @__PURE__ */ React.createElement("div", { className: "vg-shell" }, /* @__PURE__ */ React.createElement("div", { className: "vg-main" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Accounts"), /* @__PURE__ */ React.createElement("button", { className: cls("vg-acct", accountId === "all" && "sel"), onClick: () => setAccountId("all") }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", null, "All accounts"), /* @__PURE__ */ React.createElement("div", { className: "meta" }, ACCOUNTS.length, " linked \xB7 consolidated")), /* @__PURE__ */ React.createElement("span", { className: "bal" }, usd(LOTS.reduce((s, l) => s + lotValue(l), 0)))), ACCOUNTS.map((a) => /* @__PURE__ */ React.createElement("button", { key: a.id, className: cls("vg-acct", accountId === a.id && "sel"), onClick: () => setAccountId(a.id) }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", null, a.name), /* @__PURE__ */ React.createElement("div", { className: "meta" }, a.type, " \xB7 synced ", a.lastSync)), /* @__PURE__ */ React.createElement("span", { className: "bal" }, usd(accountValue(a.id))))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 12 } }, "Linked read-only via aggregator (demo). Vantage never holds funds or places orders.")), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Why cross-account?"), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13.5, color: "var(--color-grey)", margin: "0 0 10px" } }, "Wash sales, overlap, and allocation drift only show up when every account is viewed together \u2014 a buy in one account can void a tax loss harvested in another."), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => {
      setNotifOpen(true);
    } }, unread ? `${unread} unread alert${unread > 1 ? "s" : ""} \u2192` : "View notifications \u2192"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("section", { className: "vg-section", id: "portfolio" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", null, "Portfolio overview"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 marked to last close"))), /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Total value", value: usd(totalValue) }), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Day P/L",
        value: signUsd(dayPl),
        deltaDir: dirCls(dayPl),
        delta: signPct(dayPl / (totalValue - dayPl) * 100)
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Unrealized P/L",
        value: signUsd(unrlPl),
        deltaDir: dirCls(unrlPl),
        delta: signPct(unrlPl / (totalValue - unrlPl) * 100)
      }
    ), /* @__PURE__ */ React.createElement(
      StatTile,
      {
        label: "Harvestable losses",
        value: usd(harvestableLoss),
        note: `\u2248 ${usd(estBenefit)} est. benefit at ${settings.taxRate}%`
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 14.5 } }, "Allocation by asset class"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "target 70 / 10 / 15 / 5")), /* @__PURE__ */ React.createElement("div", { className: "vg-allocbar", style: { marginTop: 12 }, role: "img", "aria-label": "Asset allocation" }, Object.entries(ASSET_CLASSES).map(([k, m]) => {
      const pct = totalValue ? alloc.byClass[k] / totalValue * 100 : 0;
      return pct > 0 && /* @__PURE__ */ React.createElement("span", { key: k, style: { width: `${pct}%`, background: m.color }, title: `${m.label} ${pct.toFixed(1)}%` });
    })), /* @__PURE__ */ React.createElement("div", { className: "vg-legend" }, Object.entries(ASSET_CLASSES).map(([k, m]) => {
      const pct = totalValue ? alloc.byClass[k] / totalValue * 100 : 0;
      const drift = pct - ALLOCATION_TARGETS[k];
      return /* @__PURE__ */ React.createElement("span", { key: k }, /* @__PURE__ */ React.createElement("span", { className: "sw", style: { background: m.color } }), m.label, " ", /* @__PURE__ */ React.createElement("span", { className: "num" }, pct.toFixed(1), "%"), " ", accountId === "all" && Math.abs(drift) >= 3 && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", drift > 0 ? "warn" : "info") }, signPct(drift, 1), " vs target"));
    })))), /* @__PURE__ */ React.createElement("section", { className: "vg-section", id: "holdings" }, /* @__PURE__ */ React.createElement("h2", null, "Holdings"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 ", pos.filter((p) => p.symbol !== "CASH").length, " positions \xB7 click a row for per-lot detail"), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Symbol"), /* @__PURE__ */ React.createElement("th", null, "Accounts"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Value"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Day"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Weight"), /* @__PURE__ */ React.createElement("th", null, "Flags"))), /* @__PURE__ */ React.createElement("tbody", null, pos.map((p) => /* @__PURE__ */ React.createElement(React.Fragment, { key: p.symbol }, /* @__PURE__ */ React.createElement("tr", { className: "click", onClick: () => setExpanded((e) => ({ ...e, [p.symbol]: !e[p.symbol] })) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, p.symbol === "CASH" ? "Cash" : p.symbol), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, MARKET[p.symbol].name)), /* @__PURE__ */ React.createElement("td", null, [...p.accounts].map((id) => /* @__PURE__ */ React.createElement("span", { className: "vg-chip", key: id }, ACCOUNTS.find((a) => a.id === id).short))), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(p.value)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(p.dayPl)) }, p.symbol === "CASH" ? "\u2014" : signUsd(p.dayPl)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(p.unrl)) }, p.symbol === "CASH" ? "\u2014" : signUsd(p.unrl)), /* @__PURE__ */ React.createElement("td", { className: "num" }, p.weight.toFixed(1), "%"), /* @__PURE__ */ React.createElement("td", null, p.overlap && accountId === "all" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info", title: `Held as ${p.overlap.symbols.join(", ")}` }, "Overlap: ", p.overlap.label), p.symbol !== "CASH" && p.weight > 7 && MARKET[p.symbol].name.indexOf("ETF") === -1 && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn" }, "Concentrated"))), expanded[p.symbol] && p.lots.map((l, i) => /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow", key: i }, /* @__PURE__ */ React.createElement("td", { style: { paddingLeft: 26 } }, "lot \xB7 ", fmtDate(l.date)), /* @__PURE__ */ React.createElement("td", null, ACCOUNTS.find((a) => a.id === l.account).short), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(lotValue(l))), /* @__PURE__ */ React.createElement("td", { className: "num" }, l.symbol === "CASH" ? "\u2014" : `${l.shares} sh @ ${usd(l.costPerShare, 2)}`), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(lotUnrl(l))) }, l.symbol === "CASH" ? "\u2014" : signUsd(lotUnrl(l))), /* @__PURE__ */ React.createElement("td", { className: "num", colSpan: 2 }, l.symbol === "CASH" ? "" : `${daysAgo(l.date) > 365 ? "long-term" : "short-term"}`))))))))), /* @__PURE__ */ React.createElement("section", { className: "vg-section", id: "tax" }, /* @__PURE__ */ React.createElement("h2", null, "Tax Center \u2014 loss harvesting"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Every lot marked to last close \xB7 wash-sale window checked across ", /* @__PURE__ */ React.createElement("b", null, "all ", ACCOUNTS.length, " accounts"), " \xB7 threshold ", usd(settings.thresholdUsd), " or ", settings.thresholdPct, "% \xB7 decision-support only, no orders placed"), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Lot"), /* @__PURE__ */ React.createElement("th", null, "Account"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", null, "Status"), /* @__PURE__ */ React.createElement("th", null, "Action"))), /* @__PURE__ */ React.createElement("tbody", null, tlh.map((c, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, c.lot.symbol), " \xB7 ", c.lot.shares, " sh @ ", usd(c.lot.costPerShare, 2), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "bought ", fmtDate(c.lot.date))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, c.acct.short)), /* @__PURE__ */ React.createElement("td", { className: "num down" }, signUsd(c.unrl), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", signPct(-c.lossPct), ")")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u2713 Clear to harvest"), c.status === "blocked" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Wash-sale blocked"), c.status === "below" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "Below threshold"), c.status === "na" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "N/A \u2014 tax-advantaged"), c.status === "blocked" && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { maxWidth: 320, marginTop: 4 } }, c.wash.reason, ". Clears ", c.wash.clearsOn === "auto-buy paused" ? "once the auto-buy is paused" : c.wash.clearsOn, ".")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && (c.replacement ? /* @__PURE__ */ React.createElement("span", null, "Sell \u2192 buy ", /* @__PURE__ */ React.createElement("b", null, c.replacement), " ", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "different index, near-identical exposure")) : /* @__PURE__ */ React.createElement("span", null, "Sell, wait 31 days to rebuy", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "no like-exposure partner for single stock"))), c.status === "blocked" && c.wash.futureRisk && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Pause ", c.wash.futureRisk.symbol, " auto-buy to open a window"), (c.status === "below" || c.status === "na") && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Monitor"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement(
      FAQItem,
      {
        question: "Why does a buy in my IRA block a harvest in my brokerage account?",
        open: washFaqOpen,
        onToggle: () => setWashFaqOpen(!washFaqOpen)
      },
      "The IRS wash-sale rule disallows a loss if you buy a substantially identical security within 30 days before or after the sale \u2014 in any of your accounts, including IRAs (Rev. Rul. 2008-5) and a spouse's accounts. Single-account tools miss this; Vantage checks every linked account plus scheduled auto-invests before calling a loss harvestable. Estimated benefit assumes your ",
      settings.taxRate,
      "% marginal rate \u2014 change it in Settings."
    ))), /* @__PURE__ */ React.createElement("section", { className: "vg-section", id: "recs" }, /* @__PURE__ */ React.createElement("h2", null, "Recommendations"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Ranked by estimated annual impact \xB7 generated from cross-account analysis"), /* @__PURE__ */ React.createElement("div", { className: "vg-grid2" }, /* @__PURE__ */ React.createElement(SecurityCard, { accent: "teal", title: `Harvest IWM loss \u2192 \u2248 ${usd(1513 * settings.taxRate / 100)} benefit` }, "Fidelity IWM lot is \u2212$1,513. No conflicting buys in any account. Sell IWM, buy IJR to keep small-cap exposure with a different index."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "orange", title: "Pause Jul VOO auto-buy before harvesting" }, "The VOO loss in Fidelity (\u2212$268) is washed by Wealthfront's monthly auto-invest. Pausing one cycle opens a clean 31-day window."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "red", title: "Concentration: NVDA is 7.9% of portfolio" }, "Largest single-stock risk. Gain goes long-term Aug 15 \u2014 trimming after that date cuts the tax cost of de-risking roughly in half."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "purple", title: "Same exposure held 3 ways" }, "VOO, SPY and VTI overlap (US large blend, 54% combined). Standardize one fund per account to simplify rebalancing and future TLH pairs."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "blue", title: "Rebalance with contributions, not sales" }, "US equity is +8 pts over target. Redirect 401(k) payroll buys to BND \u2014 drift closes in ~5 months with zero tax cost."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "cyan", title: `Cash drag: ${usd(10500)} idle` }, "Combined sweep cash earns ~0.4%. A money-market fund adds \u2248 $430/yr at current rates without losing liquidity."))), /* @__PURE__ */ React.createElement("section", { className: "vg-section", id: "markets" }, /* @__PURE__ */ React.createElement("h2", null, "Market intelligence"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "AI-generated market read \xB7 educational only, not trade recommendations"), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, Object.keys(AI_INSIGHTS).map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: cls("vg-pill", symbol === s && "sel"), onClick: () => setSymbol(s) }, s))), /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", AI_INSIGHTS[symbol].bias) }, AI_INSIGHTS[symbol].bias)), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14.5, lineHeight: 1.55, margin: "14px 0" } }, AI_INSIGHTS[symbol].summary), /* @__PURE__ */ React.createElement("div", { className: "vg-grid2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 12.5, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, "Momentum"), /* @__PURE__ */ React.createElement("span", null, AI_INSIGHTS[symbol].momentum, "/100")), /* @__PURE__ */ React.createElement("div", { className: "vg-meter" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${AI_INSIGHTS[symbol].momentum}%` } }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 12.5, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, "Sentiment"), /* @__PURE__ */ React.createElement("span", null, AI_INSIGHTS[symbol].sentiment, "/100")), /* @__PURE__ */ React.createElement("div", { className: "vg-meter" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${AI_INSIGHTS[symbol].sentiment}%`, background: "var(--color-secondary)" } }))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today's AI picks"), /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap" }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("tbody", null, AI_PICKS.map((p) => /* @__PURE__ */ React.createElement("tr", { key: p.sym, className: "click", onClick: () => AI_INSIGHTS[p.sym] && setSymbol(p.sym) }, /* @__PURE__ */ React.createElement("td", { style: { width: 70 } }, /* @__PURE__ */ React.createElement("b", null, p.sym)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", p.stance), style: { fontSize: 12 } }, p.stance)), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, p.note), /* @__PURE__ */ React.createElement("td", { className: "num", style: { width: 90 } }, p.conf, "% conf"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "AI pattern signals"), /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", signalsTab === "active" && "sel"), onClick: () => setSignalsTab("active") }, "Active (", SIGNALS.filter((s) => s.status === "active").length, ")"), /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", signalsTab === "past" && "sel"), onClick: () => setSignalsTab("past") }, "Past (", SIGNALS.filter((s) => s.status !== "active").length, ")"))), /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Ticker"), /* @__PURE__ */ React.createElement("th", null, "Pattern"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Entry"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Target"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Stop"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Move"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Conf"), /* @__PURE__ */ React.createElement("th", null, "Status"))), /* @__PURE__ */ React.createElement("tbody", null, SIGNALS.filter((s) => signalsTab === "active" ? s.status === "active" : s.status !== "active").map((s) => /* @__PURE__ */ React.createElement("tr", { key: s.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, s.sym), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.time)), /* @__PURE__ */ React.createElement("td", null, s.pattern), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.entry.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.target.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.stop.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(s.movePct)) }, signPct(s.movePct, 1)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.conf, "%"), /* @__PURE__ */ React.createElement("td", null, s.status === "active" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u25CF Active"), s.status === "hit-target" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "\u2713 Hit target"), s.status === "stopped" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Stopped")))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Sector heatmap \u2014 S&P 100, 1-day change"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "green = up \xB7 red = down \xB7 click a stock for detail")), /* @__PURE__ */ React.createElement("div", { className: "vg-heat" }, SECTORS.map((sec) => /* @__PURE__ */ React.createElement("div", { className: "vg-heat-sector", key: sec.name }, /* @__PURE__ */ React.createElement("h4", null, sec.name, /* @__PURE__ */ React.createElement("span", { className: dirCls(sec.pct), style: { color: sec.pct >= 0 ? "var(--vg-success-deep)" : "var(--vg-danger)" } }, signPct(sec.pct))), /* @__PURE__ */ React.createElement("div", { className: "vg-heat-tiles" }, sec.stocks.map((st) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: st.sym,
        className: "vg-heat-tile",
        style: { background: heatTint(st.pct) },
        onClick: () => setAnalysisSym(st)
      },
      /* @__PURE__ */ React.createElement("div", { className: "s" }, st.sym),
      /* @__PURE__ */ React.createElement("div", { className: "p" }, signPct(st.pct))
    )))))))))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { textAlign: "center", marginTop: 40 } }, "Vantage prototype \xB7 built on the Lookey design system \xB7 simulated data \xB7 AI analysis is educational only \u2014 not financial, investment, or tax advice.")), /* @__PURE__ */ React.createElement("div", { className: "vg-fabs" }, /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Notifications", onClick: () => setNotifOpen(true) }, "\u{1F514}", unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "cnt" }, unread)), /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Vantage AI chat", onClick: () => setChatOpen(true) }, "\u{1F4AC}")), notifOpen && /* @__PURE__ */ React.createElement(
      NotifPanel,
      {
        notifs,
        setNotifs,
        settings,
        saveSettings,
        onClose: () => setNotifOpen(false)
      }
    ), chatOpen && /* @__PURE__ */ React.createElement(ChatPanel, { onClose: () => setChatOpen(false) }), settingsOpen && /* @__PURE__ */ React.createElement(
      SettingsModal,
      {
        settings,
        onSave: (s) => {
          saveSettings(s);
          setSettingsOpen(false);
        },
        onClose: () => setSettingsOpen(false)
      }
    ), analysisSym && /* @__PURE__ */ React.createElement(AnalysisModal, { stock: analysisSym, onClose: () => setAnalysisSym(null) }));
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
  function ChatPanel({ onClose }) {
    const [msgs, setMsgs] = useState([
      { who: "ai", text: "Hi \u2014 I'm Vantage AI. I can see across all 4 of your linked accounts. Ask me about harvesting, wash sales, overlap, or your allocation." }
    ]);
    const [draft, setDraft] = useState("");
    const bodyRef = useRef(null);
    useEffect(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs]);
    const send = () => {
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      setMsgs((m) => [...m, { who: "me", text }]);
      const rule = CHAT_RULES.find((r) => r.match.test(text));
      setTimeout(() => setMsgs((m) => [...m, { who: "ai", text: rule.reply }]), 450);
    };
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-scrim", onClick: onClose }), /* @__PURE__ */ React.createElement("div", { className: "vg-panel" }, /* @__PURE__ */ React.createElement("div", { className: "vg-panel-head" }, /* @__PURE__ */ React.createElement("h3", null, "Vantage AI"), /* @__PURE__ */ React.createElement("button", { className: "vg-x", "aria-label": "Close", onClick: onClose }, "\xD7")), /* @__PURE__ */ React.createElement("div", { className: "vg-panel-body", ref: bodyRef }, msgs.map((m, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: cls("vg-msg", m.who) }, m.text))), /* @__PURE__ */ React.createElement("div", { className: "vg-chatform" }, /* @__PURE__ */ React.createElement(
      FormField,
      {
        placeholder: "Ask about your portfolio\u2026",
        value: draft,
        onChange: (e) => setDraft(e.target.value),
        id: "chat-input"
      }
    ), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: send }, "Send")), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { padding: "0 16px 12px", margin: 0 } }, "Demo assistant with canned responses \xB7 educational only.")));
  }
  function SettingsModal({ settings, onSave, onClose }) {
    const [draft, setDraft] = useState(settings);
    return /* @__PURE__ */ React.createElement(Modal, { title: "Settings", open: true, onClose }, /* @__PURE__ */ React.createElement(
      FormField,
      {
        as: "select",
        label: "Default view",
        id: "set-acct",
        value: draft.defaultAccount,
        onChange: (e) => setDraft({ ...draft, defaultAccount: e.target.value })
      },
      /* @__PURE__ */ React.createElement("option", { value: "all" }, "All accounts"),
      ACCOUNTS.map((a) => /* @__PURE__ */ React.createElement("option", { key: a.id, value: a.id }, a.name))
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
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginTop: 16, justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(Button, { variant: "outline", onClick: onClose }, "Cancel"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: () => onSave(draft) }, "Save")));
  }
  function AnalysisModal({ stock, onClose }) {
    const insight = AI_INSIGHTS[stock.sym];
    const held = LOTS.filter((l) => l.symbol === stock.sym);
    const [why, setWhy] = useState(false);
    return /* @__PURE__ */ React.createElement(Modal, { title: `${stock.sym} \u2014 analysis`, open: true, onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", stock.pct >= 0 ? "good" : "bad") }, signPct(stock.pct), " today"), insight && /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", insight.bias), style: { fontSize: 12 } }, insight.bias), held.length > 0 ? /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "You hold this in ", [...new Set(held.map((l) => ACCOUNTS.find((a) => a.id === l.account).short))].join(", ")) : /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "Not held")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, lineHeight: 1.5 } }, insight ? insight.summary : `No AI note for ${stock.sym} in this demo \u2014 showing market context only. Sector move ${signPct(stock.pct)} on the day.`), /* @__PURE__ */ React.createElement(FAQItem, { question: "How is this rating generated?", open: why, onToggle: () => setWhy(!why) }, "In the real product this blends trend, momentum, volume and options-flow features into a single bias score. In this prototype it is illustrative mock data \u2014 educational only, never trading advice."));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
