// Vantage prototype — mock dataset. All figures are fabricated for demo purposes.
// Frozen "today" so wash-sale math is deterministic in the prototype.
export const TODAY = new Date("2026-07-05T09:30:00-04:00");

export const ACCOUNTS = [
  { id: "fid-taxable", name: "Fidelity Individual", short: "Fidelity", type: "Taxable", taxable: true,  lastSync: "8:30 AM" },
  { id: "schwab-roth", name: "Schwab Roth IRA",     short: "Roth IRA", type: "Roth IRA", taxable: false, lastSync: "8:30 AM" },
  { id: "vg-401k",     name: "Vanguard 401(k)",     short: "401(k)",  type: "401(k)",   taxable: false, lastSync: "Yesterday" },
  { id: "wf-robo",     name: "Wealthfront Automated", short: "Robo",  type: "Taxable · Robo", taxable: true, lastSync: "8:31 AM" },
];

// symbol -> market info. assetClass: usEquity | intlEquity | bonds | cash
export const MARKET = {
  VOO:  { name: "Vanguard S&P 500 ETF",        price: 683.20, dayPct: -0.12, assetClass: "usEquity" },
  SPY:  { name: "SPDR S&P 500 ETF",            price: 744.78, dayPct: -0.13, assetClass: "usEquity" },
  VTI:  { name: "Vanguard Total Market ETF",   price: 330.45, dayPct: -0.10, assetClass: "usEquity" },
  QQQ:  { name: "Invesco Nasdaq-100 ETF",      price: 625.40, dayPct: 0.21,  assetClass: "usEquity" },
  SCHG: { name: "Schwab US Large Growth ETF",  price: 32.05,  dayPct: 0.18,  assetClass: "usEquity" },
  IWM:  { name: "iShares Russell 2000 ETF",    price: 297.58, dayPct: -0.58, assetClass: "usEquity" },
  IJR:  { name: "iShares S&P SmallCap 600",    price: 130.22, dayPct: -0.44, assetClass: "usEquity" },
  NVDA: { name: "NVIDIA Corp",                 price: 194.83, dayPct: -1.39, assetClass: "usEquity" },
  AAPL: { name: "Apple Inc",                   price: 308.63, dayPct: 0.84,  assetClass: "usEquity" },
  TSLA: { name: "Tesla Inc",                   price: 393.45, dayPct: -2.49, assetClass: "usEquity" },
  BND:  { name: "Vanguard Total Bond ETF",     price: 74.20,  dayPct: 0.05,  assetClass: "bonds" },
  VXUS: { name: "Vanguard Total Intl ETF",     price: 71.50,  dayPct: 0.32,  assetClass: "intlEquity" },
  CASH: { name: "Cash & sweep",                price: 1,      dayPct: 0,     assetClass: "cash" },
};

// Tax lots per account (sentinel tlh_monitor.py lots-file shape, plus account dimension).
export const LOTS = [
  { account: "fid-taxable", symbol: "VOO",  date: "2025-11-03", shares: 40,  costPerShare: 640.00 },
  { account: "fid-taxable", symbol: "VOO",  date: "2026-05-28", shares: 12,  costPerShare: 705.50 },
  { account: "fid-taxable", symbol: "NVDA", date: "2025-08-15", shares: 60,  costPerShare: 121.40 },
  { account: "fid-taxable", symbol: "IWM",  date: "2026-02-12", shares: 45,  costPerShare: 331.20 },
  { account: "fid-taxable", symbol: "AAPL", date: "2025-12-01", shares: 25,  costPerShare: 289.10 },
  { account: "fid-taxable", symbol: "BND",  date: "2026-03-17", shares: 120, costPerShare: 75.60 },
  { account: "fid-taxable", symbol: "CASH", date: "2026-07-01", shares: 6400, costPerShare: 1 },

  { account: "schwab-roth", symbol: "QQQ",  date: "2026-01-20", shares: 30,  costPerShare: 598.20 },
  { account: "schwab-roth", symbol: "SPY",  date: "2026-02-03", shares: 18,  costPerShare: 731.40 },
  { account: "schwab-roth", symbol: "VXUS", date: "2025-10-09", shares: 150, costPerShare: 68.90 },
  { account: "schwab-roth", symbol: "CASH", date: "2026-07-01", shares: 1200, costPerShare: 1 },

  { account: "vg-401k",     symbol: "VTI",  date: "2025-06-30", shares: 180, costPerShare: 302.50 },
  { account: "vg-401k",     symbol: "SCHG", date: "2025-09-12", shares: 210, costPerShare: 29.40 },
  { account: "vg-401k",     symbol: "BND",  date: "2026-04-02", shares: 300, costPerShare: 76.80 },

  { account: "wf-robo",     symbol: "VOO",  date: "2026-04-01", shares: 8.4, costPerShare: 668.30 },
  { account: "wf-robo",     symbol: "VTI",  date: "2025-11-20", shares: 22,  costPerShare: 315.90 },
  { account: "wf-robo",     symbol: "TSLA", date: "2026-04-10", shares: 6,   costPerShare: 441.70 },
  { account: "wf-robo",     symbol: "CASH", date: "2026-07-01", shares: 2900, costPerShare: 1 },
];

// Buys in the last 30 days (wash-sale look-back) — any account.
export const RECENT_BUYS = [
  { account: "wf-robo",     symbol: "VOO", date: "2026-07-01", note: "monthly auto-invest $500" },
  { account: "schwab-roth", symbol: "QQQ", date: "2026-06-18", note: "dividend reinvestment" },
  { account: "vg-401k",     symbol: "VTI", date: "2026-06-30", note: "payroll contribution" },
];

// Scheduled recurring buys (wash-sale look-forward) — sentinel auto_buys shape.
export const AUTO_BUYS = [
  { account: "wf-robo", symbol: "VOO", dayOfMonth: 1, amount: 500 },
  { account: "vg-401k", symbol: "VTI", cadence: "biweekly payroll" },
];

// Different-INDEX replacement partners (sentinel tlh_monitor.py DEFAULT_PAIRS).
export const PARTNER_MAP = {
  VOO: "VTI", SPY: "VTI", IVV: "VTI",
  QQQM: "SCHG", QQQ: "SCHG",
  IJR: "VB", IWM: "IJR",
  VTI: "VOO", VB: "IJR", SCHG: "VUG",
};

// Substantially-identical families: a buy of any member restarts the wash clock
// for every other member, in ANY account (incl. IRAs — IRS Rev. Rul. 2008-5).
export const WASH_FAMILIES = [
  ["VOO", "SPY", "IVV"],          // same index: S&P 500
  ["QQQ", "QQQM"],                // same index: Nasdaq-100
];

// Near-identical exposure held in 2+ places → overlap/consolidation flag.
export const OVERLAP_GROUPS = [
  { label: "US large blend", symbols: ["VOO", "SPY", "VTI", "IVV"] },
  { label: "US large growth", symbols: ["QQQ", "QQQM", "SCHG"] },
  { label: "US small cap", symbols: ["IWM", "IJR", "VB"] },
];

export const WASH_WINDOW_DAYS = 30;

export const TICKER_STRIP = [
  { sym: "SPY", label: "SPY", price: "744.78", pct: -0.13 },
  { sym: "QQQ", label: "QQQ", price: "625.40", pct: 0.21 },
  { sym: "IWM", label: "IWM", price: "297.58", pct: -0.58 },
  { sym: "VIX", label: "VIX", price: "15.81", pct: 2.11 },
  { sym: "TLT", label: "TLT", price: "85.51", pct: 0.01 },
  { sym: "GLD", label: "GLD", price: "378.13", pct: 2.03 },
  { sym: "BTC", label: "BTC-USD", price: "62,648", pct: -0.70 },
  { sym: "OIL", label: "WTI", price: "68.78", pct: 0.13 },
];

export const AI_INSIGHTS = {
  SPY: { bias: "Neutral", momentum: 42, sentiment: 48,
    summary: "Market trend is mildly bearish but momentum lacks conviction. Breadth is thin and leadership is rotating out of megacap tech. Avoid new long entries until stabilization; support sits near 738, resistance 752." },
  QQQ: { bias: "Bullish", momentum: 63, sentiment: 61,
    summary: "Growth is holding its uptrend on improving volume. A close above 628 opens the prior high; risk is defined below the 20-day at 612." },
  NVDA: { bias: "Bearish", momentum: 31, sentiment: 39,
    summary: "Distribution days are stacking up and relative strength has rolled over. Below 190 the next demand zone is 178–182. Wait for a base before adding." },
  TSLA: { bias: "Bearish", momentum: 24, sentiment: 33,
    summary: "Breakdown from the April range is still working lower on elevated volume. No edge on the long side until a reclaim of 410." },
  AAPL: { bias: "Bullish", momentum: 71, sentiment: 66,
    summary: "Strong accumulation into product-cycle expectations. Pullbacks toward 300 have been bought; momentum favors continuation while above 296." },
  MSFT: { bias: "Neutral", momentum: 50, sentiment: 52,
    summary: "Consolidating in a tight multi-week range. Coiled setup: watch a break of 396 up or 384 down for direction." },
};

export const AI_PICKS = [
  { sym: "AAPL", stance: "Bullish", conf: 78, note: "Accumulation trend, product-cycle tailwind" },
  { sym: "QQQ",  stance: "Bullish", conf: 72, note: "Uptrend intact above the 20-day" },
  { sym: "SPY",  stance: "Neutral", conf: 60, note: "Chop zone 738–752, no edge" },
  { sym: "NVDA", stance: "Bearish", conf: 67, note: "Relative strength rolling over" },
  { sym: "TSLA", stance: "Bearish", conf: 70, note: "Range breakdown still working" },
];

export const SIGNALS = [
  { id: 1, sym: "PLTR", pattern: "Cup & Handle",       entry: 168.40, target: 177.20, stop: 163.90, movePct: 5.2, conf: 89, time: "09:41", status: "active" },
  { id: 2, sym: "SMCI", pattern: "Ascending Triangle", entry: 54.10,  target: 56.70,  stop: 52.60,  movePct: 4.8, conf: 87, time: "09:37", status: "active" },
  { id: 3, sym: "SOFI", pattern: "Flag Breakout",      entry: 21.35,  target: 22.20,  stop: 20.80,  movePct: 4.1, conf: 85, time: "09:35", status: "active" },
  { id: 4, sym: "RKLB", pattern: "Wedge Breakout",     entry: 38.90,  target: 40.60,  stop: 37.80,  movePct: 4.3, conf: 83, time: "09:33", status: "active" },
  { id: 5, sym: "HOOD", pattern: "Double Bottom",      entry: 42.15,  target: 43.80,  stop: 41.10,  movePct: 3.9, conf: 82, time: "09:30", status: "active" },
  { id: 6, sym: "AMD",  pattern: "Bear Put Spread",    entry: 148.20, target: 141.00, stop: 152.40, movePct: -4.9, conf: 82, time: "Jul 2", status: "hit-target" },
  { id: 7, sym: "GOOGL",pattern: "Call Ladder",        entry: 231.10, target: 239.50, stop: 226.00, movePct: 3.6, conf: 84, time: "Jul 1", status: "hit-target" },
  { id: 8, sym: "META", pattern: "Breakout Retest",    entry: 588.00, target: 610.00, stop: 574.00, movePct: 3.7, conf: 76, time: "Jun 30", status: "stopped" },
];

export const SECTORS = [
  { name: "Technology", pct: -0.73, stocks: [
    { sym: "NVDA", pct: -1.39 }, { sym: "AAPL", pct: 0.84 }, { sym: "MSFT", pct: 0.62 },
    { sym: "AVGO", pct: -2.41 }, { sym: "AMD", pct: -4.26 }, { sym: "ORCL", pct: -1.56 } ] },
  { name: "Comm. Services", pct: 1.01, stocks: [
    { sym: "GOOGL", pct: -0.36 }, { sym: "META", pct: -1.90 }, { sym: "NFLX", pct: 4.66 },
    { sym: "DIS", pct: 3.96 }, { sym: "TMUS", pct: 2.58 }, { sym: "T", pct: 0.49 } ] },
  { name: "Consumer Disc.", pct: 0.74, stocks: [
    { sym: "AMZN", pct: 0.40 }, { sym: "TSLA", pct: -2.49 }, { sym: "HD", pct: 2.01 },
    { sym: "MCD", pct: 4.16 }, { sym: "NKE", pct: 2.39 }, { sym: "SBUX", pct: 0.85 } ] },
  { name: "Financials", pct: 1.10, stocks: [
    { sym: "BRK.B", pct: 1.61 }, { sym: "JPM", pct: 0.12 }, { sym: "V", pct: 3.15 },
    { sym: "MA", pct: 3.24 }, { sym: "BAC", pct: 0.63 }, { sym: "GS", pct: 0.14 } ] },
  { name: "Healthcare", pct: 3.29, stocks: [
    { sym: "LLY", pct: 1.86 }, { sym: "UNH", pct: -0.28 }, { sym: "JNJ", pct: 3.57 },
    { sym: "ABBV", pct: 3.99 }, { sym: "MRK", pct: 3.34 }, { sym: "AMGN", pct: 3.55 } ] },
  { name: "Industrials", pct: 1.70, stocks: [
    { sym: "GE", pct: 0.69 }, { sym: "RTX", pct: 3.90 }, { sym: "CAT", pct: -2.81 },
    { sym: "HON", pct: 3.66 }, { sym: "LMT", pct: 4.62 }, { sym: "DE", pct: -1.01 } ] },
  { name: "Consumer Staples", pct: 2.77, stocks: [
    { sym: "WMT", pct: 2.78 }, { sym: "PG", pct: 2.70 }, { sym: "COST", pct: 2.92 },
    { sym: "KO", pct: 3.51 }, { sym: "PEP", pct: 2.17 }, { sym: "PM", pct: 2.58 } ] },
  { name: "Energy", pct: 1.19, stocks: [
    { sym: "XOM", pct: 0.59 }, { sym: "CVX", pct: 2.12 }, { sym: "COP", pct: 1.46 },
    { sym: "SLB", pct: 0.09 }, { sym: "EOG", pct: 1.70 } ] },
  { name: "Real Estate", pct: 0.53, stocks: [
    { sym: "AMT", pct: -0.03 }, { sym: "EQIX", pct: -1.14 }, { sym: "PLD", pct: 1.92 },
    { sym: "SPG", pct: 1.37 } ] },
  { name: "Materials", pct: 1.90, stocks: [
    { sym: "LIN", pct: 2.45 }, { sym: "SHW", pct: 1.86 }, { sym: "APD", pct: 2.54 },
    { sym: "FCX", pct: 0.73 } ] },
  { name: "Utilities", pct: 2.78, stocks: [
    { sym: "NEE", pct: 2.28 }, { sym: "SO", pct: 3.01 }, { sym: "DUK", pct: 3.05 } ] },
];

export const NOTIFICATIONS_SEED = [
  { id: 1, type: "tlh",   title: "TLH opportunity: IWM", body: "Fidelity lot from Feb 12 is $1,513 underwater — past your $200 harvest threshold. Suggested replacement: IJR.", time: "8:32 AM", read: false },
  { id: 2, type: "wash",  title: "Wash-sale risk: VOO", body: "Harvesting the Fidelity VOO loss is blocked — Wealthfront auto-bought VOO on Jul 1. Window clears Jul 31.", time: "8:32 AM", read: false },
  { id: 3, type: "drift", title: "Allocation drift +4.2%", body: "US equity is 4.2% above your 70% target across all accounts. Consider directing new contributions to bonds.", time: "8:30 AM", read: false },
  { id: 4, type: "price", title: "NVDA down 1.4% premarket", body: "NVDA is your largest single-stock position (7.9% of portfolio). AI bias flipped to Bearish.", time: "7:55 AM", read: true },
  { id: 5, type: "tlh",   title: "TSLA loss past threshold", body: "Wealthfront TSLA lot is $290 underwater. No recent buys detected in any account — clear to harvest.", time: "Yesterday", read: true },
  { id: 6, type: "system", title: "Vanguard 401(k) synced", body: "Holdings refreshed. Payroll contribution of $730 landed in VTI on Jun 30.", time: "Yesterday", read: true },
  { id: 7, type: "price", title: "AAPL new 3-month high", body: "AAPL closed above 308. Held in Fidelity Individual (25 sh).", time: "Jul 2", read: true },
  { id: 8, type: "drift", title: "Cash drag: $10,500 idle", body: "Combined sweep cash is earning ~0.4%. A money-market fund would add ≈ $430/yr at current rates.", time: "Jul 1", read: true },
];

export const NOTIF_TYPES = {
  tlh:    { label: "Tax-loss harvesting", accent: "teal",   icon: "🌾" },
  wash:   { label: "Wash-sale warnings",  accent: "orange", icon: "⚠️" },
  price:  { label: "Price & AI alerts",   accent: "blue",   icon: "📈" },
  drift:  { label: "Allocation drift",    accent: "purple", icon: "⚖️" },
  system: { label: "Account sync",        accent: "cyan",   icon: "🔄" },
};

export const CHAT_RULES = [
  { match: /wash|blocked/i, reply: "Your VOO harvest is blocked because Wealthfront's auto-invest bought VOO on Jul 1 — a purchase of a substantially identical security in ANY of your accounts (even an IRA) restarts the 30-day wash-sale clock. Options: pause the Jul auto-buy and harvest after Jul 31, or harvest into VTI now from the Fidelity side only if you also skip the August auto-buy." },
  { match: /tlh|harvest|tax/i, reply: "Across your 4 accounts I see two clean harvest candidates today: IWM in Fidelity (−$1,513, replace with IJR) and TSLA in Wealthfront (−$290, no replacement pair — wait 31 days to rebuy). Combined estimated after-tax benefit ≈ $433 at your 24% marginal rate. VOO is also underwater but wash-blocked until Jul 31." },
  { match: /overlap|duplicate|consolidat/i, reply: "You hold the same US large-blend exposure in three places: VOO (Fidelity + Wealthfront), SPY (Roth), and VTI (401(k) + Wealthfront) — together 54% of your portfolio. That's fine for tax-lot flexibility, but it makes rebalancing noisy. Consider standardizing on one fund per account going forward." },
  { match: /alloc|balance|drift/i, reply: "Consolidated allocation: 78% US equity, 7% international, 9% bonds, 6% cash — vs your 70/10/15/5 target. You're overweight US equity by ~8 points. Cheapest fix: direct new 401(k) contributions to BND rather than selling (no tax cost)." },
  { match: /nvda|nvidia/i, reply: "NVDA is 7.9% of your combined portfolio — your largest single-stock bet, all in the Fidelity taxable account with a $4,406 unrealized gain (long-term as of Aug 15). AI bias just flipped Bearish. If you trim, the long-term rate applies after Aug 15 — worth waiting 6 weeks if you can tolerate the drawdown." },
  { match: /.*/, reply: "I can help with anything across your linked accounts — try asking about tax-loss harvesting, wash-sale status, overlap between accounts, allocation drift, or any position you hold. (Demo assistant: canned responses, educational only.)" },
];

export const ALLOCATION_TARGETS = { usEquity: 70, intlEquity: 10, bonds: 15, cash: 5 };

export const ASSET_CLASSES = {
  usEquity:   { label: "US Equity",     color: "#2e68fd" },
  intlEquity: { label: "International", color: "#0d9488" },
  bonds:      { label: "Bonds",         color: "#932cfa" },
  cash:       { label: "Cash",          color: "#ca8a04" },
};

/* ================= v2 additions: options intelligence + AI charts ================= */

// Options context per symbol (mock): IV rank, expected move to next monthly, put/call ratio.
export const OPTIONS_CONTEXT = {
  SPY:  { ivRank: 38, expMove: "±1.2%", pcr: 1.08 },
  QQQ:  { ivRank: 41, expMove: "±1.6%", pcr: 0.92 },
  NVDA: { ivRank: 72, expMove: "±6.8%", pcr: 0.81 },
  TSLA: { ivRank: 81, expMove: "±8.4%", pcr: 0.77 },
  AAPL: { ivRank: 35, expMove: "±3.1%", pcr: 0.95 },
  MSFT: { ivRank: 29, expMove: "±2.7%", pcr: 1.02 },
  IWM:  { ivRank: 54, expMove: "±2.3%", pcr: 1.21 },
};

// Unusual options activity (mock, f6io-style flow).
export const OPTIONS_FLOW = [
  { sym: "QQQ",  side: "CALL", kind: "Sweep",  detail: "Aug 21 · 640C", premium: "$2.1M", sentiment: "Bullish", conf: 91, time: "09:41" },
  { sym: "MSFT", side: "CALL", kind: "Block",  detail: "Sep 18 · 400C", premium: "$1.4M", sentiment: "Bullish", conf: 89, time: "09:35" },
  { sym: "AMZN", side: "PUT",  kind: "Block",  detail: "Aug 21 · 235P", premium: "$3.3M", sentiment: "Bearish", conf: 86, time: "09:37" },
  { sym: "GOOGL",side: "CALL", kind: "Ladder", detail: "Aug 21 · 235/240/245C", premium: "$860K", sentiment: "Bullish", conf: 84, time: "09:33" },
  { sym: "AMD",  side: "PUT",  kind: "Spread", detail: "Aug 21 · 150/140P", premium: "$690K", sentiment: "Bearish", conf: 82, time: "09:30" },
];

// Income ideas generated against YOUR holdings and cash — the cross-account angle.
export const INCOME_IDEAS = [
  { kind: "Covered call", sym: "VXUS", acct: "schwab-roth", basis: "150 sh in Roth IRA",
    contract: "Aug 21 · 73C", delta: 0.24, premium: 0.55, yieldAnn: 4.6,
    note: "Roth allows covered calls; premium compounds tax-free. Caps upside above 73." },
  { kind: "Cash-secured put", sym: "SOFI", acct: "fid-taxable", basis: "$6,400 idle cash",
    contract: "Aug 21 · 20P", delta: 0.31, premium: 0.62, yieldAnn: 11.2,
    note: "Collateral $2,000. Entry at 19.38 net if assigned — flag setup also on the signals scanner." },
  { kind: "Covered call", sym: "VTI", acct: "vg-401k", basis: "180 sh in 401(k)",
    contract: "Aug 21 · 340C", delta: 0.22, premium: 1.85, yieldAnn: 3.9,
    note: "Only if your 401(k) brokerage window permits options — most don't. Shown for completeness." },
  { kind: "Not yet eligible", sym: "NVDA", acct: "fid-taxable", basis: "60 of 100 sh needed",
    contract: "—", delta: null, premium: null, yieldAnn: null,
    note: "40 more shares unlock covered calls (~$2,600/yr at current IV 72 rank). High IV makes NVDA the best premium on your book." },
];

// Chart series parameters (seeded random walk ending exactly at MARKET price).
export const CHART_PARAMS = {
  SPY:  { vol: 0.008, drift:  0.0002 },
  QQQ:  { vol: 0.011, drift:  0.0004 },
  NVDA: { vol: 0.022, drift: -0.0010 },
  TSLA: { vol: 0.026, drift: -0.0015 },
  AAPL: { vol: 0.013, drift:  0.0008 },
  MSFT: { vol: 0.010, drift:  0.0001 },
  IWM:  { vol: 0.012, drift: -0.0004 },
};

// AI markers: `ago` = trading bars back from the latest bar.
export const CHART_MARKERS = {
  SPY:  [ { ago: 82, type: "buy",  label: "AI: accumulation zone 705–715" },
          { ago: 44, type: "note", label: "AI: breakout confirmed on volume" },
          { ago: 18, type: "sell", label: "AI: distribution cluster" },
          { ago: 5,  type: "note", label: "AI bias flip → Neutral" } ],
  QQQ:  [ { ago: 60, type: "buy",  label: "AI: reclaimed 20-day on volume" },
          { ago: 12, type: "note", label: "AI: higher-low confirmed" } ],
  NVDA: [ { ago: 90, type: "buy",  label: "AI: base breakout 118" },
          { ago: 35, type: "sell", label: "AI: relative-strength rollover — trim" },
          { ago: 10, type: "sell", label: "AI bias flip → Bearish" } ],
  TSLA: [ { ago: 58, type: "sell", label: "AI: range breakdown 441" },
          { ago: 20, type: "note", label: "AI: failed reclaim of 410" } ],
  AAPL: [ { ago: 70, type: "buy",  label: "AI: cup base pivot 296" },
          { ago: 15, type: "buy",  label: "AI: pullback bought at 300" } ],
  MSFT: [ { ago: 40, type: "note", label: "AI: coiling 384–396" } ],
  IWM:  [ { ago: 75, type: "sell", label: "AI: lower high vs Feb" },
          { ago: 22, type: "note", label: "TLH: lot crossed −10% — harvest window" } ],
};

export const CHART_LEVELS = {
  SPY:  { support: 738, resistance: 752 },
  QQQ:  { support: 612, resistance: 628 },
  NVDA: { support: 182, resistance: 205 },
  TSLA: { support: 372, resistance: 410 },
  AAPL: { support: 296, resistance: 315 },
  MSFT: { support: 384, resistance: 396 },
  IWM:  { support: 288, resistance: 312 },
};

// The AI recommendation panel beside the chart — portfolio-aware where held.
export const CHART_RECS = {
  SPY:  { action: "Hold — no new entries", detail: "Chop zone 738–752 with thinning breadth. Wait for a range resolution before sizing up either way.", risk: "A close below 738 opens 724." },
  QQQ:  { action: "Hold; add only above 628", detail: "Uptrend intact over the 20-day. Your Roth QQQ lot is +$816 — dividend reinvest on Jun 18 keeps its wash clock running.", risk: "Loses the setup below 612." },
  NVDA: { action: "Trim after Aug 15", detail: "You hold 60 sh in Fidelity, +$4,406 — the lot turns long-term Aug 15. AI bias is Bearish; if de-risking, waiting ~6 weeks roughly halves the tax on the gain.", risk: "Below 190 the next demand zone is 178–182." },
  TSLA: { action: "Harvest candidate", detail: "Robo lot is −$290 and clear to harvest across all accounts. No like-exposure partner — expect 31 days out of the name.", risk: "Dead-cat rallies to 410 are sellable, not ownable." },
  AAPL: { action: "Let the winner run", detail: "Accumulation trend with pullbacks bought at 300. Your Fidelity lot is +$488; no action needed.", risk: "Momentum thesis breaks under 296." },
  MSFT: { action: "Wait for the range break", detail: "Six-week coil 384–396. Direction of the break sets the next swing; no position across your accounts.", risk: "Fakeouts are common in week 1 of a break." },
  IWM:  { action: "Harvest → IJR swap", detail: "Fidelity lot −$1,513 (−10.2%), clear in every account. Sell IWM, buy IJR same day: different index, near-identical small-cap exposure, loss banked.", risk: "Small caps are the highest-beta sleeve on your book." },
};
