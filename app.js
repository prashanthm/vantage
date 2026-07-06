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
  var OPTIONS_CONTEXT = {
    SPY: { ivRank: 38, expMove: "\xB11.2%", pcr: 1.08 },
    QQQ: { ivRank: 41, expMove: "\xB11.6%", pcr: 0.92 },
    NVDA: { ivRank: 72, expMove: "\xB16.8%", pcr: 0.81 },
    TSLA: { ivRank: 81, expMove: "\xB18.4%", pcr: 0.77 },
    AAPL: { ivRank: 35, expMove: "\xB13.1%", pcr: 0.95 },
    MSFT: { ivRank: 29, expMove: "\xB12.7%", pcr: 1.02 },
    IWM: { ivRank: 54, expMove: "\xB12.3%", pcr: 1.21 }
  };
  var OPTIONS_FLOW = [
    { sym: "QQQ", side: "CALL", kind: "Sweep", detail: "Aug 21 \xB7 640C", premium: "$2.1M", sentiment: "Bullish", conf: 91, time: "09:41" },
    { sym: "MSFT", side: "CALL", kind: "Block", detail: "Sep 18 \xB7 400C", premium: "$1.4M", sentiment: "Bullish", conf: 89, time: "09:35" },
    { sym: "AMZN", side: "PUT", kind: "Block", detail: "Aug 21 \xB7 235P", premium: "$3.3M", sentiment: "Bearish", conf: 86, time: "09:37" },
    { sym: "GOOGL", side: "CALL", kind: "Ladder", detail: "Aug 21 \xB7 235/240/245C", premium: "$860K", sentiment: "Bullish", conf: 84, time: "09:33" },
    { sym: "AMD", side: "PUT", kind: "Spread", detail: "Aug 21 \xB7 150/140P", premium: "$690K", sentiment: "Bearish", conf: 82, time: "09:30" }
  ];
  var INCOME_IDEAS = [
    {
      kind: "Covered call",
      sym: "VXUS",
      acct: "schwab-roth",
      basis: "150 sh in Roth IRA",
      contract: "Aug 21 \xB7 73C",
      delta: 0.24,
      premium: 0.55,
      yieldAnn: 4.6,
      note: "Roth allows covered calls; premium compounds tax-free. Caps upside above 73."
    },
    {
      kind: "Cash-secured put",
      sym: "SOFI",
      acct: "fid-taxable",
      basis: "$6,400 idle cash",
      contract: "Aug 21 \xB7 20P",
      delta: 0.31,
      premium: 0.62,
      yieldAnn: 11.2,
      note: "Collateral $2,000. Entry at 19.38 net if assigned \u2014 flag setup also on the signals scanner."
    },
    {
      kind: "Covered call",
      sym: "VTI",
      acct: "vg-401k",
      basis: "180 sh in 401(k)",
      contract: "Aug 21 \xB7 340C",
      delta: 0.22,
      premium: 1.85,
      yieldAnn: 3.9,
      note: "Only if your 401(k) brokerage window permits options \u2014 most don't. Shown for completeness."
    },
    {
      kind: "Not yet eligible",
      sym: "NVDA",
      acct: "fid-taxable",
      basis: "60 of 100 sh needed",
      contract: "\u2014",
      delta: null,
      premium: null,
      yieldAnn: null,
      note: "40 more shares unlock covered calls (~$2,600/yr at current IV 72 rank). High IV makes NVDA the best premium on your book."
    }
  ];
  var CHART_PARAMS = {
    SPY: { vol: 8e-3, drift: 2e-4 },
    QQQ: { vol: 0.011, drift: 4e-4 },
    NVDA: { vol: 0.022, drift: -1e-3 },
    TSLA: { vol: 0.026, drift: -15e-4 },
    AAPL: { vol: 0.013, drift: 8e-4 },
    MSFT: { vol: 0.01, drift: 1e-4 },
    IWM: { vol: 0.012, drift: -4e-4 }
  };
  var CHART_MARKERS = {
    SPY: [
      { ago: 82, type: "buy", label: "AI: accumulation zone 705\u2013715" },
      { ago: 44, type: "note", label: "AI: breakout confirmed on volume" },
      { ago: 18, type: "sell", label: "AI: distribution cluster" },
      { ago: 5, type: "note", label: "AI bias flip \u2192 Neutral" }
    ],
    QQQ: [
      { ago: 60, type: "buy", label: "AI: reclaimed 20-day on volume" },
      { ago: 12, type: "note", label: "AI: higher-low confirmed" }
    ],
    NVDA: [
      { ago: 90, type: "buy", label: "AI: base breakout 118" },
      { ago: 35, type: "sell", label: "AI: relative-strength rollover \u2014 trim" },
      { ago: 10, type: "sell", label: "AI bias flip \u2192 Bearish" }
    ],
    TSLA: [
      { ago: 58, type: "sell", label: "AI: range breakdown 441" },
      { ago: 20, type: "note", label: "AI: failed reclaim of 410" }
    ],
    AAPL: [
      { ago: 70, type: "buy", label: "AI: cup base pivot 296" },
      { ago: 15, type: "buy", label: "AI: pullback bought at 300" }
    ],
    MSFT: [{ ago: 40, type: "note", label: "AI: coiling 384\u2013396" }],
    IWM: [
      { ago: 75, type: "sell", label: "AI: lower high vs Feb" },
      { ago: 22, type: "note", label: "TLH: lot crossed \u221210% \u2014 harvest window" }
    ]
  };
  var CHART_LEVELS = {
    SPY: { support: 738, resistance: 752 },
    QQQ: { support: 612, resistance: 628 },
    NVDA: { support: 182, resistance: 205 },
    TSLA: { support: 372, resistance: 410 },
    AAPL: { support: 296, resistance: 315 },
    MSFT: { support: 384, resistance: 396 },
    IWM: { support: 288, resistance: 312 }
  };
  var CHART_RECS = {
    SPY: { action: "Hold \u2014 no new entries", detail: "Chop zone 738\u2013752 with thinning breadth. Wait for a range resolution before sizing up either way.", risk: "A close below 738 opens 724." },
    QQQ: { action: "Hold; add only above 628", detail: "Uptrend intact over the 20-day. Your Roth QQQ lot is +$816 \u2014 dividend reinvest on Jun 18 keeps its wash clock running.", risk: "Loses the setup below 612." },
    NVDA: { action: "Trim after Aug 15", detail: "You hold 60 sh in Fidelity, +$4,406 \u2014 the lot turns long-term Aug 15. AI bias is Bearish; if de-risking, waiting ~6 weeks roughly halves the tax on the gain.", risk: "Below 190 the next demand zone is 178\u2013182." },
    TSLA: { action: "Harvest candidate", detail: "Robo lot is \u2212$290 and clear to harvest across all accounts. No like-exposure partner \u2014 expect 31 days out of the name.", risk: "Dead-cat rallies to 410 are sellable, not ownable." },
    AAPL: { action: "Let the winner run", detail: "Accumulation trend with pullbacks bought at 300. Your Fidelity lot is +$488; no action needed.", risk: "Momentum thesis breaks under 296." },
    MSFT: { action: "Wait for the range break", detail: "Six-week coil 384\u2013396. Direction of the break sets the next swing; no position across your accounts.", risk: "Fakeouts are common in week 1 of a break." },
    IWM: { action: "Harvest \u2192 IJR swap", detail: "Fidelity lot \u2212$1,513 (\u221210.2%), clear in every account. Sell IWM, buy IJR same day: different index, near-identical small-cap exposure, loss banked.", risk: "Small caps are the highest-beta sleeve on your book." }
  };

  // src/util.jsx
  var usd = (n, digits = 0) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  var signUsd = (n) => `${n >= 0 ? "+" : "\u2212"}${usd(Math.abs(n))}`;
  var signPct = (n, d = 2) => `${n >= 0 ? "+" : "\u2212"}${Math.abs(n).toFixed(d)}%`;
  var cls = (...xs) => xs.filter(Boolean).join(" ");
  var dirCls = (n) => n > 0 ? "up" : n < 0 ? "down" : "";
  var DAY_MS = 864e5;
  var daysAgo = (iso) => Math.floor((TODAY - /* @__PURE__ */ new Date(iso + "T12:00:00")) / DAY_MS);
  var fmtDate = (iso) => {
    const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
    return isNaN(d) ? String(iso || "\u2014") : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var addDays = (iso, n) => {
    const d = /* @__PURE__ */ new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  var isOptionSym = (sym) => /\d{4}-\d{2}-\d{2} \d+(\.\d+)?[CP]$/.test(sym || "");
  var lotValue = (l) => {
    const m = MARKET[l.symbol];
    return l.shares * (m ? m.price : l.costPerShare);
  };
  var lotCost = (l) => l.shares * l.costPerShare;
  var lotUnrl = (l) => lotValue(l) - lotCost(l);
  var _liveAccounts = {};
  var registerAccounts = (list) => {
    for (const a of list || []) if (a && a.id) _liveAccounts[a.id] = a;
  };
  var acctOf = (id) => ACCOUNTS.find((a) => a.id === id) || _liveAccounts[id] || { id, name: id, short: id, type: "", taxable: true };
  function washFamily(sym) {
    const fam = WASH_FAMILIES.find((f) => f.includes(sym));
    return fam ? fam : [sym];
  }
  function washStatus(sym) {
    const fam = washFamily(sym);
    const past = RECENT_BUYS.find((b) => fam.includes(b.symbol) && daysAgo(b.date) <= WASH_WINDOW_DAYS);
    if (past) {
      return {
        blocked: true,
        reason: `${acctOf(past.account).short} bought ${past.symbol} on ${fmtDate(past.date)} (${past.note})`,
        clearsOn: addDays(past.date, WASH_WINDOW_DAYS + 1),
        futureRisk: AUTO_BUYS.find((ab) => fam.includes(ab.symbol))
      };
    }
    const future = AUTO_BUYS.find((ab) => fam.includes(ab.symbol) && ab.dayOfMonth != null);
    if (future) {
      return {
        blocked: true,
        reason: `${acctOf(future.account).short} auto-buys ${future.symbol} monthly (next: Aug ${future.dayOfMonth}) \u2014 a buy within 30 days after the sale washes it`,
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
      const acct = acctOf(l.account);
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
  function heatTint(pct2) {
    if (Math.abs(pct2) < 0.15) return "#f1f5f9";
    const a = Math.min(0.08 + Math.abs(pct2) / 5 * 0.3, 0.38);
    return pct2 > 0 ? `rgba(5,150,105,${a.toFixed(3)})` : `rgba(220,38,38,${a.toFixed(3)})`;
  }

  // src/ohlc.js
  function mulberry32(a) {
    return function() {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var seedOf = (s) => [...s].reduce((h, c) => h * 31 + c.charCodeAt(0) | 0, 7);
  function gauss(rnd) {
    const u = Math.max(rnd(), 1e-9), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function genOHLC(sym, endPrice, { vol, drift }, endDate, markers = [], n = 120) {
    const rnd = mulberry32(seedOf(sym));
    const rets = Array.from({ length: n - 1 }, () => drift + vol * gauss(rnd));
    const closes = new Array(n);
    closes[n - 1] = endPrice;
    for (let i = n - 2; i >= 0; i--) closes[i] = closes[i + 1] / Math.exp(rets[i]);
    const dates = new Array(n);
    const d = new Date(endDate);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    for (let i = n - 1; i >= 0; i--) {
      dates[i] = new Date(d);
      do {
        d.setDate(d.getDate() - 1);
      } while (d.getDay() === 0 || d.getDay() === 6);
    }
    const markAt = new Map(markers.map((m) => [n - 1 - m.ago, m]));
    return closes.map((c, i) => {
      const o = i === 0 ? c * (1 - vol / 2) : closes[i - 1];
      const wickH = Math.abs(vol * gauss(rnd)) * 0.7, wickL = Math.abs(vol * gauss(rnd)) * 0.7;
      const h = Math.max(o, c) * (1 + wickH), l = Math.min(o, c) * (1 - wickL);
      const marker = markAt.get(i);
      const v = Math.round((0.8 + rnd() * 0.7 + (marker ? 1.1 : 0) + Math.abs(c / o - 1) * 60) * 100) / 100;
      return { date: dates[i], o, h, l, c, v, marker };
    });
  }

  // src/live.js
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
  var backendBase = () => (loadSettings().backendUrl || "").replace(/\/+$/, "");
  var miraBase = () => (loadSettings().miraUrl || "").replace(/\/+$/, "");
  var health = () => getJson(`${backendBase()}/api/health`);
  var accounts = () => getJson(`${backendBase()}/api/accounts`);
  var positions2 = (account = "all") => getJson(`${backendBase()}/api/positions?account=${encodeURIComponent(account)}`);
  var allocation2 = (account = "all") => getJson(`${backendBase()}/api/allocation?account=${encodeURIComponent(account)}`);
  var tlh = ({ thresholdUsd, thresholdPct } = {}) => {
    const q = new URLSearchParams();
    if (thresholdUsd != null) q.set("thresholdUsd", String(thresholdUsd));
    if (thresholdPct != null) q.set("thresholdPct", String(thresholdPct));
    const qs = q.toString();
    return getJson(`${backendBase()}/api/tax/tlh${qs ? `?${qs}` : ""}`);
  };
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
    return payload.positions.map((p) => ({
      symbol: p.symbol,
      shares: p.shares,
      value: p.value,
      cost: p.cost,
      unrl: p.unrealized,
      dayPl: p.day_pl,
      weight: p.weight,
      accounts: p.accounts,
      // array; views spread it like the fixture Set
      lots: (p.lots || []).map(mapLot),
      overlap: p.overlap || null
    }));
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
    return { byClass, total: payload.total };
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
    mark: l.mark
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
      costBasis: cb ? {
        equity: cb.equity ? { shares: cb.equity.shares, avgCost: cb.equity.avg_cost } : null,
        options: cb.options ? { contracts: cb.options.contracts, avgCost: cb.options.avg_cost } : null
      } : null,
      levels: payload.levels || { daily: {}, weekly: {}, monthly: {} },
      analysis: payload.analysis ? mapDecision(payload.analysis) : null
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
      }
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
  var _threadId = null;
  function threadId() {
    if (!_threadId) _threadId = `vantage-${Date.now()}`;
    return _threadId;
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
  function useLive(fetcher, fallback, deps = []) {
    const [liveData, setLiveData] = React.useState(null);
    React.useEffect(() => {
      let alive = true;
      setLiveData(null);
      Promise.resolve().then(fetcher).then((d) => {
        if (alive && d != null) setLiveData(d);
      }).catch(() => {
      });
      return () => {
        alive = false;
      };
    }, deps);
    return { data: liveData != null ? liveData : fallback, isLive: liveData != null };
  }

  // src/charts.jsx
  var { useState, useMemo, useRef, useEffect } = React;
  var { FAQItem } = window.LookeyDS;
  var TF_LIVE = [
    { key: "daily", label: "Daily" },
    { key: "weekly", label: "Weekly" },
    { key: "monthly", label: "Monthly" }
  ];
  var TIMEFRAMES = [{ key: "1M", bars: 22 }, { key: "3M", bars: 66 }, { key: "6M", bars: 120 }];
  var UP = "#059669";
  var DOWN = "#dc2626";
  var STRIKE_COLOR = "#7c3aed";
  var COST_COLOR = "#932cfa";
  var PRICE_COLOR = "#0f172a";
  var MAX_LEVELS_PER_SIDE = 6;
  var fmtD = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  var hasLW = () => typeof window !== "undefined" && !!(window.LightweightCharts && window.LightweightCharts.createChart);
  var CONVICTION = {
    strong: { text: "STRONG", fg: "#056645", bg: "#e7f6ef" },
    neutral: { text: "NEUTRAL", fg: "#475569", bg: "#eef1f6" },
    weak: { text: "WEAK", fg: "#92600a", bg: "#fdf0d9" },
    freefall: { text: "FREEFALL", fg: "#a01818", bg: "#fdeaea" }
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
    return /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 0.3,
      padding: "3px 10px",
      borderRadius: 999,
      color: c.fg,
      background: c.bg
    } }, c.text), /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 12,
      fontWeight: 700,
      padding: "3px 10px",
      borderRadius: 999,
      color: "#0f172a",
      background: "#eef1f6",
      border: "1px solid #dfe4ec"
    } }, rec));
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
  function levelLine(level, isSupport) {
    const strength = Math.max(1, Math.min(5, Number(level.strength) || 1));
    const width = Math.max(1, Math.round(strength / 1.5));
    const base = isSupport ? [5, 150, 105] : [220, 38, 38];
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
      const chart = LW.createChart(el, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: "#64748b", fontSize: 11 },
        grid: { vertLines: { color: "#f1f5f9" }, horzLines: { color: "#f1f5f9" } },
        rightPriceScale: { borderColor: "#e2e8f0" },
        timeScale: { borderColor: "#e2e8f0", timeVisible: false },
        crosshair: { mode: LW.CrosshairMode.Normal }
      });
      const candle = chart.addCandlestickSeries({
        upColor: UP,
        downColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN
      });
      const volume = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        color: "rgba(100,116,139,0.4)"
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
      volume.setData(bars.bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? "rgba(5,150,105,0.35)" : "rgba(220,38,38,0.35)"
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
      const add = (opts) => {
        priceLinesRef.current.push(candle.createPriceLine(opts));
      };
      const levels = bars && bars.levels || overlay.levels && overlay.levels[tf] || { support: [], resistance: [] };
      const topBy = (arr) => [...arr || []].sort((a, b) => (b.strength || 0) - (a.strength || 0)).slice(0, MAX_LEVELS_PER_SIDE);
      topBy(levels.support).forEach((lv) => add(levelLine(lv, true)));
      topBy(levels.resistance).forEach((lv) => add(levelLine(lv, false)));
      const label = strikeLabel(overlay.analysis && overlay.analysis.action);
      if (label && overlay.analysis.action.suggestedStrike != null) {
        add({
          price: Number(overlay.analysis.action.suggestedStrike),
          color: STRIKE_COLOR,
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
          color: COST_COLOR,
          lineWidth: 1,
          lineStyle: window.LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: `cost ${Number(cost).toFixed(2)}`
        });
      }
      if (overlay.currentPrice != null) {
        add({
          price: Number(overlay.currentPrice),
          color: PRICE_COLOR,
          lineWidth: 1,
          lineStyle: window.LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: "price"
        });
      }
    }, [overlay, bars, tf]);
    const analysis = overlay && overlay.analysis;
    const rationale = badgeRationale(analysis);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "AI Charts"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { margin: "4px 0 0" } }, "Live candles from your bars snapshot \xB7 S/R, strike & cost overlays \xB7 educational only")), /* @__PURE__ */ React.createElement(SymbolPills, { symbol, setSymbol })), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { padding: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 8, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 17 } }, symbol), overlay && overlay.currentPrice != null && /* @__PURE__ */ React.createElement("b", { style: { fontSize: 16 } }, usd(overlay.currentPrice, 2)), /* @__PURE__ */ React.createElement(ConvictionBadge, { analysis })), /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, TF_LIVE.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.key, className: cls("vg-pill", tf === t.key && "sel"), onClick: () => setTf(t.key) }, t.label)))), rationale && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "0 0 10px", lineHeight: 1.5 } }, rationale), /* @__PURE__ */ React.createElement("div", { className: "vg-chartwrap", style: { position: "relative" } }, /* @__PURE__ */ React.createElement("div", { ref: containerRef, style: { width: "100%", height: "100%" } }), loading && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { position: "absolute", top: 8, left: 8 } }, "loading\u2026")), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginTop: 10, fontSize: 12, color: "var(--color-grey)", flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: UP } }), " support (by strength)"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: DOWN } }), " resistance (by strength)"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: STRIKE_COLOR } }), " suggested call strike"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: COST_COLOR } }), " your cost basis"))));
  }
  var NON_TICKER = /* @__PURE__ */ new Set(["CASH", "CRYPTO", "FUTURES", "SWEEP"]);
  var underlyingOf = (sym) => String(sym).split(" ")[0].toUpperCase();
  function useSymbolChoices() {
    const live_ = useLive(() => positions2().then((p) => mapPositions(p)), null, []);
    const rawHeld = (live_.data || []).map((p) => p.symbol);
    const rawFixture = [...new Set(LOTS.map((l) => l.symbol))];
    const normalize = (arr) => {
      const seen = /* @__PURE__ */ new Set();
      const out2 = [];
      for (const s of arr) {
        const u = underlyingOf(s);
        if (NON_TICKER.has(u) || seen.has(u)) continue;
        seen.add(u);
        out2.push(u);
      }
      return out2;
    };
    const source = rawHeld.length ? normalize(rawHeld) : normalize(rawFixture);
    const out = [...source];
    for (const s of Object.keys(CHART_PARAMS)) if (!out.includes(s)) out.push(s);
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
    if (mode === "probing") {
      return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "AI Charts"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { margin: "4px 0 0" } }, "loading live candles\u2026")), /* @__PURE__ */ React.createElement(SymbolPills, { symbol, setSymbol })), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { padding: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-chartwrap" })));
    }
    return /* @__PURE__ */ React.createElement(SvgChart, { symbol, setSymbol });
  }
  function useSize(ref, fallback) {
    const [size, setSize] = useState(fallback);
    useEffect(() => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === "undefined") return void 0;
      const ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [ref]);
    return size;
  }
  function SvgChart({ symbol, setSymbol }) {
    const [tf, setTf] = useState("3M");
    const [hover, setHover] = useState(null);
    const wrapRef = useRef(null);
    const size = useSize(wrapRef, { w: 960, h: 450 });
    const params = CHART_PARAMS[symbol] || CHART_PARAMS.SPY;
    const price = MARKET[symbol] && MARKET[symbol].price || 100;
    const all = useMemo(
      () => genOHLC(symbol, price, params, TODAY, CHART_MARKERS[symbol] || []),
      [symbol]
      // eslint-disable-line react-hooks/exhaustive-deps
    );
    const bars = useMemo(() => all.slice(-TIMEFRAMES.find((t) => t.key === tf).bars), [all, tf]);
    const held = LOTS.filter((l) => l.symbol === symbol);
    const heldShares = held.reduce((s, l) => s + l.shares, 0);
    const avgCost = heldShares ? held.reduce((s, l) => s + lotCost(l), 0) / heldShares : null;
    const W = Math.max(320, size.w), VH = 70, PADR = 56, PADT = 10;
    const H = Math.max(240, size.h - VH);
    const plotW = W - PADR, n = bars.length;
    const levels = CHART_LEVELS[symbol];
    let lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
    if (levels) {
      lo = Math.min(lo, levels.support);
      hi = Math.max(hi, levels.resistance);
    }
    if (avgCost != null) {
      lo = Math.min(lo, avgCost);
      hi = Math.max(hi, avgCost);
    }
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const y = (p) => PADT + (hi - p) / (hi - lo) * (H - PADT - 6);
    const x = (i) => (i + 0.5) * (plotW / n);
    const cw = Math.max(2, plotW / n * 0.62);
    const maxV = Math.max(...bars.map((b) => b.v));
    const insight = AI_INSIGHTS[symbol];
    const onMove = (e) => {
      const rect = wrapRef.current.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width * W;
      const i = Math.min(n - 1, Math.max(0, Math.floor(px / (plotW / n))));
      setHover(px <= plotW ? i : null);
    };
    const gridLines = 4;
    const hb = hover != null ? bars[hover] : null;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "AI Charts"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub", style: { margin: "4px 0 0" } }, "Simulated candles \xB7 AI markers & levels are illustrative \xB7 educational only")), /* @__PURE__ */ React.createElement(SymbolPills, { symbol, setSymbol: (s) => {
      setSymbol(s);
      setHover(null);
    } })), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { padding: 16 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-row" }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 17 } }, symbol), MARKET[symbol] && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, MARKET[symbol].name), MARKET[symbol] && /* @__PURE__ */ React.createElement("b", { style: { fontSize: 16 } }, usd(MARKET[symbol].price, 2)), MARKET[symbol] && /* @__PURE__ */ React.createElement("span", { className: dirCls(MARKET[symbol].dayPct), style: { color: MARKET[symbol].dayPct >= 0 ? UP : DOWN, fontWeight: 600 } }, signPct(MARKET[symbol].dayPct)), insight && /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", insight.bias), style: { fontSize: 12 } }, insight.bias)), /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, TIMEFRAMES.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.key, className: cls("vg-pill", tf === t.key && "sel"), onClick: () => {
      setTf(t.key);
      setHover(null);
    } }, t.key)))), /* @__PURE__ */ React.createElement("div", { ref: wrapRef, className: "vg-chartwrap", onMouseMove: onMove, onMouseLeave: () => setHover(null) }, /* @__PURE__ */ React.createElement(
      "svg",
      {
        viewBox: `0 0 ${W} ${H + VH}`,
        preserveAspectRatio: "none",
        role: "img",
        "aria-label": `${symbol} candlestick chart, ${tf}`
      },
      Array.from({ length: gridLines + 1 }, (_, g) => {
        const p = lo + (hi - lo) * g / gridLines;
        return /* @__PURE__ */ React.createElement("g", { key: g }, /* @__PURE__ */ React.createElement("line", { x1: 0, x2: plotW, y1: y(p), y2: y(p), stroke: "#eef1f6" }), /* @__PURE__ */ React.createElement("text", { x: plotW + 8, y: y(p) + 4, fontSize: "11", fill: "#94a3b8" }, p >= 100 ? p.toFixed(0) : p.toFixed(1)));
      }),
      levels && /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("line", { x1: 0, x2: plotW, y1: y(levels.resistance), y2: y(levels.resistance), stroke: DOWN, strokeDasharray: "6 4", strokeOpacity: "0.55" }), /* @__PURE__ */ React.createElement("text", { x: 6, y: y(levels.resistance) - 5, fontSize: "10.5", fill: DOWN }, "resistance ", levels.resistance), /* @__PURE__ */ React.createElement("line", { x1: 0, x2: plotW, y1: y(levels.support), y2: y(levels.support), stroke: UP, strokeDasharray: "6 4", strokeOpacity: "0.55" }), /* @__PURE__ */ React.createElement("text", { x: 6, y: y(levels.support) + 13, fontSize: "10.5", fill: UP }, "support ", levels.support)),
      avgCost != null && /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("line", { x1: 0, x2: plotW, y1: y(avgCost), y2: y(avgCost), stroke: "#932cfa", strokeDasharray: "2 4", strokeWidth: "1.6" }), /* @__PURE__ */ React.createElement("text", { x: plotW - 4, y: y(avgCost) - 5, fontSize: "10.5", fill: "#932cfa", textAnchor: "end" }, "your avg cost ", usd(avgCost, 2))),
      bars.map((b, i) => {
        const up = b.c >= b.o;
        return /* @__PURE__ */ React.createElement("g", { key: i }, /* @__PURE__ */ React.createElement("line", { x1: x(i), x2: x(i), y1: y(b.h), y2: y(b.l), stroke: up ? UP : DOWN, strokeWidth: "1" }), /* @__PURE__ */ React.createElement(
          "rect",
          {
            x: x(i) - cw / 2,
            y: y(Math.max(b.o, b.c)),
            width: cw,
            height: Math.max(1.5, Math.abs(y(b.o) - y(b.c))),
            rx: "1",
            fill: up ? UP : DOWN
          }
        ));
      }),
      bars.map((b, i) => b.marker && /* @__PURE__ */ React.createElement("g", { key: `m${i}`, className: "vg-marker" }, b.marker.type === "buy" && /* @__PURE__ */ React.createElement("path", { d: `M ${x(i)} ${y(b.l) + 8} l 6 10 l -12 0 z`, fill: "#2e68fd" }), b.marker.type === "sell" && /* @__PURE__ */ React.createElement("path", { d: `M ${x(i)} ${y(b.h) - 18} l 6 -10 l -12 0 z`, fill: "#dc2626" }), b.marker.type === "note" && /* @__PURE__ */ React.createElement("circle", { cx: x(i), cy: y(b.h) - 14, r: "5", fill: "#ca8a04" }), /* @__PURE__ */ React.createElement(
        "text",
        {
          x: x(i),
          y: b.marker.type === "buy" ? y(b.l) + 30 : y(b.h) - 26,
          fontSize: "9.5",
          fill: "#4d525f",
          textAnchor: "middle"
        },
        "AI"
      ))),
      bars.map((b, i) => /* @__PURE__ */ React.createElement(
        "rect",
        {
          key: `v${i}`,
          x: x(i) - cw / 2,
          y: H + VH - b.v / maxV * (VH - 12),
          width: cw,
          height: b.v / maxV * (VH - 12),
          rx: "1",
          fill: b.c >= b.o ? UP : DOWN,
          opacity: "0.35"
        }
      )),
      /* @__PURE__ */ React.createElement("text", { x: 0, y: H + 12, fontSize: "10", fill: "#94a3b8" }, "volume"),
      hb && /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("line", { x1: x(hover), x2: x(hover), y1: PADT, y2: H + VH, stroke: "#01081b", strokeOpacity: "0.25", strokeDasharray: "3 3" }), /* @__PURE__ */ React.createElement("line", { x1: 0, x2: plotW, y1: y(hb.c), y2: y(hb.c), stroke: "#01081b", strokeOpacity: "0.18", strokeDasharray: "3 3" }))
    ), hb && /* @__PURE__ */ React.createElement("div", { className: "vg-charttip", style: { left: `${Math.min(92, x(hover) / W * 100)}%` } }, /* @__PURE__ */ React.createElement("b", null, fmtD(hb.date)), " \xB7 O ", hb.o.toFixed(2), " \xB7 H ", hb.h.toFixed(2), " \xB7 L ", hb.l.toFixed(2), " \xB7 C ", hb.c.toFixed(2), hb.marker && /* @__PURE__ */ React.createElement("div", { className: "mk" }, hb.marker.label))), /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginTop: 10, fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "#2e68fd" } }), " AI buy/accumulation"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "#dc2626" } }), " AI sell/distribution"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "#ca8a04", borderRadius: 99 } }), " AI note"), avgCost != null && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "vg-mk-swatch", style: { background: "#932cfa" } }), " your avg cost")), /* @__PURE__ */ React.createElement("div", { className: "vg-markerlist" }, (CHART_MARKERS[symbol] || []).map((m, i) => {
      const bar = all[all.length - 1 - m.ago];
      return /* @__PURE__ */ React.createElement("span", { key: i, className: cls("vg-badge", m.type === "buy" ? "info" : m.type === "sell" ? "bad" : "warn") }, bar ? fmtD(bar.date) : "", " \u2014 ", m.label);
    }))));
  }
  function ChartsRail({ symbol }) {
    const insight = AI_INSIGHTS[symbol], rec = CHART_RECS[symbol];
    const held = LOTS.filter((l) => l.symbol === symbol);
    const heldShares = held.reduce((s, l) => s + l.shares, 0);
    const heldUnrl = held.reduce((s, l) => s + lotValue(l) - lotCost(l), 0);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "AI read"), insight && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13.5, lineHeight: 1.5, margin: "0 0 10px" } }, insight.summary), insight && /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { gap: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, "Momentum"), /* @__PURE__ */ React.createElement("span", null, insight.momentum)), /* @__PURE__ */ React.createElement("div", { className: "vg-meter" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${insight.momentum}%` } }))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, "Sentiment"), /* @__PURE__ */ React.createElement("span", null, insight.sentiment)), /* @__PURE__ */ React.createElement("div", { className: "vg-meter" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${insight.sentiment}%`, background: "var(--color-secondary)" } })))), !insight && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "No AI read for ", symbol, ".")), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Your position"), heldShares > 0 ? /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 14 } }, /* @__PURE__ */ React.createElement("b", null, heldShares, " sh \xB7 ", usd(heldShares * (MARKET[symbol] && MARKET[symbol].price || 0))), /* @__PURE__ */ React.createElement("span", { className: dirCls(heldUnrl), style: { color: heldUnrl >= 0 ? UP : DOWN, fontWeight: 600 } }, signUsd(heldUnrl))), held.map((l, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "vg-note", style: { marginTop: 6 } }, acctOf(l.account).short, ": ", l.shares, " sh @ ", usd(l.costPerShare, 2), " (", fmtDate(l.date), ")"))) : /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "Not held in any linked account.")), rec && /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-reccard" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "AI recommendation"), /* @__PURE__ */ React.createElement("div", { className: "vg-recaction" }, rec.action), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13.5, lineHeight: 1.5, margin: "8px 0" } }, rec.detail), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: 0 } }, "\u26A0 Risk: ", rec.risk)), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement(ChartFaq, null)));
  }
  function ChartFaq() {
    const [open, setOpen] = useState(false);
    return /* @__PURE__ */ React.createElement(FAQItem, { question: "What are the AI markers?", open, onToggle: () => setOpen(!open) }, "Blue triangles mark AI-detected accumulation/entry zones, red triangles distribution/exit pressure, and gold dots contextual notes (bias flips, TLH windows on lots you own). In this prototype both the candles and the markers are simulated \u2014 educational only, never trading advice.");
  }

  // src/options.jsx
  var { useState: useState2, useEffect: useEffect2 } = React;
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
    const [tab, setTab] = useState2("open");
    const [shown, setShown] = useState2(STRAT_PAGE);
    const [open, setOpen] = useState2({});
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
    useEffect2(() => {
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
  function OptionsView({ accountId = "all", setSymbol, go }) {
    const [faq, setFaq] = useState2(false);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Options Intelligence"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Volatility context, income ideas generated against your holdings, and unusual flow \xB7 educational only"), /* @__PURE__ */ React.createElement(StrategiesSection, { accountId }), /* @__PURE__ */ React.createElement("div", { className: "vg-ivgrid" }, Object.entries(OPTIONS_CONTEXT).map(([sym, c]) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: sym,
        className: "vg-ivtile",
        onClick: () => {
          setSymbol(sym);
          go("charts");
        },
        title: `Open ${sym} on AI Charts`
      },
      /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("b", null, sym), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", c.ivRank >= 60 ? "warn" : c.ivRank >= 40 ? "info" : "plain") }, "IV rank ", c.ivRank)),
      /* @__PURE__ */ React.createElement("div", { className: "vg-meter", style: { margin: "8px 0 6px" } }, /* @__PURE__ */ React.createElement("span", { style: { width: `${c.ivRank}%`, background: c.ivRank >= 60 ? "#ca8a04" : "var(--color-primary)" } })),
      /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "exp. move ", c.expMove, " \xB7 P/C ", c.pcr.toFixed(2))
    ))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 20px" } }, "High IV rank = rich premium (favor selling); low = cheap optionality (favor buying). Click a tile to open the chart."), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 4 } }, /* @__PURE__ */ React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, "Income ideas on your book"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "screened across all 4 accounts \xB7 premiums are mock")), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px", marginBottom: 20 } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Idea"), /* @__PURE__ */ React.createElement("th", null, "Backing"), /* @__PURE__ */ React.createElement("th", null, "Contract"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "\u0394"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Premium"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Ann. yield"), /* @__PURE__ */ React.createElement("th", null, "Note"))), /* @__PURE__ */ React.createElement("tbody", null, INCOME_IDEAS.map((r, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", r.kind === "Not yet eligible" ? "plain" : "good") }, r.kind), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 4 } }, /* @__PURE__ */ React.createElement("b", null, r.sym))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, acctOf(r.acct).short), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, r.basis)), /* @__PURE__ */ React.createElement("td", null, r.contract), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.delta != null ? r.delta.toFixed(2) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.premium != null ? `$${r.premium.toFixed(2)}` : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.yieldAnn != null ? `${r.yieldAnn.toFixed(1)}%` : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "vg-note", style: { maxWidth: 260 } }, r.note)))))), /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 4 } }, /* @__PURE__ */ React.createElement("h3", { style: { margin: 0, fontSize: 16 } }, "Unusual options activity"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "large prints & sweeps \xB7 mock feed")), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px", marginBottom: 20 } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Ticker"), /* @__PURE__ */ React.createElement("th", null, "Flow"), /* @__PURE__ */ React.createElement("th", null, "Contract"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Premium"), /* @__PURE__ */ React.createElement("th", null, "Read"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Conf"))), /* @__PURE__ */ React.createElement("tbody", null, OPTIONS_FLOW.map((f, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, f.sym), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, f.time)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", f.side === "CALL" ? "good" : "bad") }, f.side, " ", f.kind)), /* @__PURE__ */ React.createElement("td", null, f.detail), /* @__PURE__ */ React.createElement("td", { className: "num" }, f.premium), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", f.sentiment), style: { fontSize: 12 } }, f.sentiment)), /* @__PURE__ */ React.createElement("td", { className: "num" }, f.conf, "%")))))), /* @__PURE__ */ React.createElement("div", { className: "vg-grid2", style: { marginBottom: 20 } }, /* @__PURE__ */ React.createElement(SecurityCard, { accent: "teal", title: "Premium pairs well with your TLH calendar" }, "Selling calls against a lot you plan to harvest can wash the loss if assigned early. Vantage cross-checks every income idea against your Tax Center before suggesting it."), /* @__PURE__ */ React.createElement(SecurityCard, { accent: "orange", title: "Approval levels differ per account" }, "Roth allows covered calls and CSPs at most brokers; 401(k)s rarely allow options at all. Ideas are tagged with the account they're actually executable in.")), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement(FAQItem2, { question: "How are income ideas generated?", open: faq, onToggle: () => setFaq(!faq) }, "The screener looks for positions of 100+ shares (covered calls) and idle cash (cash-secured puts) in each linked account, targets ~0.20\u20130.30 delta at the next monthly expiry, and ranks by annualized premium yield adjusted for IV rank. In this prototype the chains are simulated \u2014 educational only, not advice.")));
  }

  // src/trades.jsx
  var { useMemo: useMemo2 } = React;
  var pct = (v) => v == null ? "\u2014" : `${Math.round(v * 100)}%`;
  var pct1 = (v) => v == null ? "\u2014" : `${(v * 100).toFixed(1)}%`;
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
        "aria-label": `Credible interval ${pct1(ciLow)} to ${pct1(ciHigh)}, baseline ${pct1(baseline)}`,
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
      base != null && /* @__PURE__ */ React.createElement("div", { title: `baseline ${pct1(baseline)}`, style: {
        position: "absolute",
        left: `${base}%`,
        top: 0,
        width: 2,
        height: 14,
        background: "var(--color-grey)",
        transform: "translateX(-1px)"
      } })
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 4, fontSize: 11.5 } }, "CI ", pct1(ciLow), "\u2013", pct1(ciHigh), " \xB7 baseline ", pct1(baseline)));
  }
  function Scorecard({ summary }) {
    const s = summary || {};
    const pf = s.profit_factor;
    return /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Win rate"), /* @__PURE__ */ React.createElement("div", { className: "val" }, pct1(s.win_rate)), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.wins ?? 0, "W / ", s.losses ?? 0, "L")), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Profit factor"), /* @__PURE__ */ React.createElement("div", { className: "val" }, num(pf)), /* @__PURE__ */ React.createElement("div", { className: cls("delta", pf != null && (pf >= 1 ? "up" : "down")) }, pf == null ? "" : pf >= 1 ? "profitable" : "below breakeven")), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Avg hold"), /* @__PURE__ */ React.createElement("div", { className: "val" }, s.avg_holding_days == null ? "\u2014" : `${num(s.avg_holding_days, 1)}d`)), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Avg MFE capture"), /* @__PURE__ */ React.createElement("div", { className: "val" }, pct(s.avg_mfe_capture)), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "share of peak move captured")), /* @__PURE__ */ React.createElement("div", { className: "vg-stat" }, /* @__PURE__ */ React.createElement("div", { className: "lbl" }, "Closed trades"), /* @__PURE__ */ React.createElement("div", { className: "val" }, s.count ?? 0), s.entry_unknown ? /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.entry_unknown, " est. entry") : null));
  }
  function NotableCards({ notable, baseline }) {
    const significant = (notable || []).filter((b) => b.significant === true);
    if (significant.length === 0) {
      return /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No defensible edges yet"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0", maxWidth: 620 } }, "No condition's win-rate separates from your ", pct1(baseline), " baseline with enough trades to be credible. Differences seen so far are within noise for the current sample \u2014 more closed round-trips are needed before a real edge or leak can be claimed."));
    }
    return /* @__PURE__ */ React.createElement("div", { className: "vg-cardgrid", style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 14,
      marginTop: 8
    } }, significant.map((b) => /* @__PURE__ */ React.createElement("div", { key: `${b.dimension}:${b.value}`, className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("strong", { style: { fontSize: 14.5 } }, b.value), /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", b.kind === "leak" ? "bad" : "good") }, b.kind === "leak" ? "\u25BC leak" : "\u25B2 edge")), /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { marginTop: 2 } }, b.dimension.replace(/_/g, " ")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24, fontWeight: 700 } }, pct1(b.win_rate)), /* @__PURE__ */ React.createElement("span", { className: cls("vg-note", b.kind === "leak" ? "down" : "up") }, signPct((b.win_rate - (baseline || 0)) * 100), " vs baseline")), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "n = ", b.n, " trades"), /* @__PURE__ */ React.createElement(
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
      return /* @__PURE__ */ React.createElement("tr", { key: `${b.dimension}:${b.value}`, style: { opacity: thin ? 0.5 : 1 } }, /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, /* @__PURE__ */ React.createElement("b", null, b.value), /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { marginLeft: 6 } }, b.dimension.replace(/_/g, " "))), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, b.n), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, pct1(b.win_rate)), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", minWidth: 180 } }, /* @__PURE__ */ React.createElement(CiBar, { ciLow: b.ci_low, ciHigh: b.ci_high, winRate: b.win_rate, baseline })), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, b.avg_pnl == null ? "\u2014" : signUsd(b.avg_pnl)), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px" } }, thin ? /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain", title: "Too few trades to be statistically defensible" }, "n too small") : null));
    }))));
  }
  function RoundtripsTable({ roundtrips, setSymbol, go }) {
    const rows = useMemo2(() => {
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
      /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 12px", textAlign: "right" }, className: "num" }, pct(r.mfe_capture))
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
    } }, /* @__PURE__ */ React.createElement("code", null, "cd server\n.venv/bin/python -m vantage_server.ml.build_roundtrips --account rh-margin --broker-account <N>\n.venv/bin/python -m vantage_server.ml.build_features --account rh-margin --from-roundtrips"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12 } }, /* @__PURE__ */ React.createElement(Scorecard, { summary })), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "Defensible edges & leaks"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "2px 0 0", maxWidth: 620 } }, "Only conditions whose 90% credible interval clears your ", pct1(baseline), " baseline with enough trades to matter. Anything thinner is held back below."), /* @__PURE__ */ React.createElement(NotableCards, { notable: ts && ts.notable, baseline }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "All conditions"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "2px 0 0", maxWidth: 620 } }, "Every entry condition by win-rate and credible interval. Rows with too few trades to be defensible are muted and marked \u201Cn too small\u201D \u2014 don't read them as signal."), /* @__PURE__ */ React.createElement(ConditionTable, { buckets: ts && ts.buckets, baseline }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginTop: 20 } }, "Recent round-trips"), /* @__PURE__ */ React.createElement(RoundtripsTable, { roundtrips: rt && rt.roundtrips, setSymbol, go })));
  }

  // src/app.jsx
  var { useState: useState3, useMemo: useMemo3, useEffect: useEffect3, useRef: useRef2 } = React;
  var { Navbar, Button, Modal, FormField, SecurityCard: SecurityCard2, FAQItem: FAQItem3 } = window.LookeyDS;
  var NAV = [
    { group: "Portfolio", items: [
      { id: "overview", label: "Overview", icon: "\u25EB" },
      { id: "holdings", label: "Holdings", icon: "\u25A4" },
      { id: "activity", label: "Activity", icon: "\u21C5" },
      { id: "tax", label: "Tax Center", icon: "\u{1F33E}" },
      { id: "recs", label: "Recommendations", icon: "\u2726" }
    ] },
    { group: "Intelligence", items: [
      { id: "markets", label: "Market Intel", icon: "\u{1F4C8}" },
      { id: "options", label: "Options Intel", icon: "\u25CE" },
      { id: "trades", label: "Trade Analytics", icon: "\u{1F9EE}" },
      { id: "charts", label: "AI Charts", icon: "\u{1F4CA}" }
    ] }
  ];
  var ROUTES = NAV.flatMap((g) => g.items.map((i) => i.id));
  function useHashRoute() {
    const initial = () => {
      const h = window.location.hash.replace(/^#\/?/, "");
      return ROUTES.includes(h) ? h : "overview";
    };
    const [route, setRoute] = useState3(initial);
    useEffect3(() => {
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
    const [settings, setSettings] = useState3(loadSettings);
    const [accountId, setAccountId] = useState3(settings.defaultAccount);
    const [symbol, setSymbol] = useState3("SPY");
    const [route, go] = useHashRoute();
    const [notifs, setNotifs] = useState3(NOTIFICATIONS_SEED);
    const [notifOpen, setNotifOpen] = useState3(false);
    const [chatOpen, setChatOpen] = useState3(false);
    const [settingsOpen, setSettingsOpen] = useState3(false);
    const [analysisSym, setAnalysisSym] = useState3(null);
    const [leftOpen, setLeftOpen] = useState3(() => window.innerWidth >= 860);
    const [rightOpen, setRightOpen] = useState3(() => window.innerWidth >= 1100);
    useEffect3(() => {
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
    const tlhFixture = useMemo3(() => tlhCandidates(settings), [settings]);
    const tlh2 = useLive(() => tlh(settings).then(mapTlh), tlhFixture, [settings]).data;
    const acctFixture = useMemo3(
      () => ACCOUNTS.map((a) => ({ id: a.id, short: a.short, type: a.type, value: accountValue(a.id) })),
      []
    );
    const scopeAccounts = useLive(
      () => accounts().then((p) => {
        if (!p || !p.accounts) return null;
        registerAccounts(p.accounts);
        return p.accounts.map((a) => ({ id: a.id, short: a.short, type: a.type, value: a.value }));
      }),
      acctFixture,
      [settings]
    ).data;
    const unread = notifs.filter((n) => !n.read && settings.notifPrefs[n.type]).length;
    const saveSettings = (next) => {
      setSettings(next);
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch (e) {
      }
    };
    const viewProps = { accountId, setAccountId, symbol, setSymbol, settings, tlh: tlh2, go, setAnalysisSym, setNotifOpen };
    const hasChartRail = route === "charts";
    return /* @__PURE__ */ React.createElement("div", { className: "vg-app" }, /* @__PURE__ */ React.createElement("div", { className: "vg-compliance" }, "AI-generated analysis \xB7 Demo with simulated data \xB7 Educational purposes only \u2014 not financial, investment, or tax advice"), /* @__PURE__ */ React.createElement(
      Navbar,
      {
        brand: "Vant",
        brandAccent: "age",
        links: [],
        cta: /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 18 } }, /* @__PURE__ */ React.createElement(LiveStatusDots, { settings }), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: () => setSettingsOpen(true) }, "Settings"))
      }
    ), /* @__PURE__ */ React.createElement("div", { className: "vg-ticker" }, TICKER_STRIP.map((t) => /* @__PURE__ */ React.createElement("span", { className: "vg-tick", key: t.sym }, /* @__PURE__ */ React.createElement("b", null, t.label), " ", t.price, /* @__PURE__ */ React.createElement("span", { className: dirCls(t.pct) }, signPct(t.pct))))), /* @__PURE__ */ React.createElement("div", { className: "vg-studio" }, /* @__PURE__ */ React.createElement("aside", { className: cls("vg-pane", "vg-pane-left", !leftOpen && "clps") }, /* @__PURE__ */ React.createElement("div", { className: "vg-pane-top" }, leftOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, "Workspace"), /* @__PURE__ */ React.createElement(
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
    ))))), leftOpen && /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-divider" }), /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { margin: "0 8px 4px" } }, "Account scope"), /* @__PURE__ */ React.createElement("button", { className: cls("vg-acct", accountId === "all" && "sel"), onClick: () => setAccountId("all") }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", null, "All accounts"), /* @__PURE__ */ React.createElement("div", { className: "meta" }, scopeAccounts.length, " linked")), /* @__PURE__ */ React.createElement("span", { className: "bal" }, usd(scopeAccounts.reduce((s, a) => s + a.value, 0)))), scopeAccounts.map((a) => /* @__PURE__ */ React.createElement("button", { key: a.id, className: cls("vg-acct", accountId === a.id && "sel"), onClick: () => setAccountId(a.id) }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", null, a.short), /* @__PURE__ */ React.createElement("div", { className: "meta" }, a.type)), /* @__PURE__ */ React.createElement("span", { className: "bal" }, usd(a.value)))), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 10, padding: "0 4px" } }, "Read-only aggregation (demo). Vantage never holds funds or places orders."), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8, padding: "0 4px" } }, "Vantage prototype \xB7 built on the Lookey design system \xB7 simulated data \xB7 AI analysis is educational only \u2014 not financial, investment, or tax advice.")))), /* @__PURE__ */ React.createElement("main", { id: "vg-center", className: "vg-pane vg-pane-center" }, route === "overview" && /* @__PURE__ */ React.createElement(OverviewView, { ...viewProps, notifs }), route === "holdings" && /* @__PURE__ */ React.createElement(HoldingsView, { ...viewProps }), route === "activity" && /* @__PURE__ */ React.createElement(ActivityView, { ...viewProps }), route === "tax" && /* @__PURE__ */ React.createElement(TaxView, { ...viewProps }), route === "recs" && /* @__PURE__ */ React.createElement(RecsView, { ...viewProps }), route === "markets" && /* @__PURE__ */ React.createElement(MarketsView, { ...viewProps }), route === "options" && /* @__PURE__ */ React.createElement(OptionsView, { accountId, setSymbol, go }), route === "trades" && /* @__PURE__ */ React.createElement(TradeAnalyticsView, { ...viewProps }), route === "charts" && /* @__PURE__ */ React.createElement(ChartsView, { symbol, setSymbol })), /* @__PURE__ */ React.createElement("aside", { className: cls("vg-pane", "vg-pane-right", !rightOpen && "clps") }, /* @__PURE__ */ React.createElement("div", { className: "vg-pane-top" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        className: "vg-collapse",
        title: rightOpen ? "Collapse panel" : "Expand panel",
        "aria-label": rightOpen ? "Collapse AI panel" : "Expand AI panel",
        onClick: () => setRightOpen(!rightOpen)
      },
      rightOpen ? "\xBB" : "\xAB"
    ), rightOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-kicker", style: { marginBottom: 0 } }, hasChartRail ? "AI insights" : "Vantage AI")), !rightOpen && /* @__PURE__ */ React.createElement("span", { className: "vg-sparkle", "aria-hidden": "true" }, "\u2726"), rightOpen && (hasChartRail ? /* @__PURE__ */ React.createElement("div", { className: "vg-pane-body vg-rail" }, /* @__PURE__ */ React.createElement(ChartsRail, { symbol })) : /* @__PURE__ */ React.createElement(ChatPanel, { docked: true, settings })))), /* @__PURE__ */ React.createElement("div", { className: "vg-fabs" }, /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Notifications", onClick: () => setNotifOpen(true) }, "\u{1F514}", unread > 0 && /* @__PURE__ */ React.createElement("span", { className: "cnt" }, unread)), (hasChartRail || !rightOpen) && /* @__PURE__ */ React.createElement("button", { className: "vg-fab", "aria-label": "Vantage AI chat", onClick: () => setChatOpen(true) }, "\u{1F4AC}")), notifOpen && /* @__PURE__ */ React.createElement(
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
        onSave: (s) => {
          saveSettings(s);
          setSettingsOpen(false);
        },
        onClose: () => setSettingsOpen(false)
      }
    ), analysisSym && /* @__PURE__ */ React.createElement(AnalysisModal, { stock: analysisSym, onClose: () => setAnalysisSym(null) }));
  }
  function LiveStatusDots({ settings }) {
    const [st, setSt] = useState3({ backend: null, mira: null });
    useEffect3(() => {
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
      width: 8,
      height: 8,
      borderRadius: "50%",
      marginRight: 5,
      background: ok ? "var(--vg-success-deep)" : "var(--color-grey)"
    });
    const aiOff = settings.aiBackend !== "mira";
    return /* @__PURE__ */ React.createElement("span", { className: "vg-note", style: { display: "inline-flex", gap: 14, alignItems: "center", whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { title: st.backend ? `Backend live at ${settings.backendUrl} \u2014 quotes: ${st.backend.source}${st.backend.stale ? " (stale)" : ""}, as of ${st.backend.as_of}` : `Backend unreachable at ${settings.backendUrl} \u2014 showing demo fixtures` }, /* @__PURE__ */ React.createElement("span", { style: dot(st.backend) }), "data ", st.backend ? "live" : "demo"), /* @__PURE__ */ React.createElement("span", { title: aiOff ? "AI backend set to Off in Settings \u2014 canned demo replies" : st.mira ? `Mira reachable at ${settings.miraUrl}` : `Mira unreachable at ${settings.miraUrl} \u2014 canned demo replies` }, /* @__PURE__ */ React.createElement("span", { style: dot(!aiOff && st.mira) }), "AI ", aiOff ? "off" : st.mira ? "live" : "demo"));
  }
  function OverviewView({ accountId, settings, tlh: tlh2, go, notifs, setNotifOpen }) {
    const posFixture = useMemo3(() => positions(accountId), [accountId]);
    const pos = useLive(() => positions2(accountId).then(mapPositions), posFixture, [accountId, settings]).data;
    const allocFixture = useMemo3(() => allocation(accountId), [accountId]);
    const alloc = useLive(() => allocation2(accountId).then(mapAllocation), allocFixture, [accountId, settings]).data;
    const totalValue = alloc.total;
    const dayPl = pos.reduce((s, p) => s + p.dayPl, 0);
    const unrlPl = pos.reduce((s, p) => s + p.unrl, 0);
    const harvestable = tlh2.filter((c) => c.status === "clear");
    const harvestableLoss = harvestable.reduce((s, c) => s + -c.unrl, 0);
    const estBenefit = harvestableLoss * (settings.taxRate / 100);
    const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
    const recent = notifs.slice(0, 3);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Overview"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 marked to last close"))), /* @__PURE__ */ React.createElement("div", { className: "vg-stats" }, /* @__PURE__ */ React.createElement(StatTile, { label: "Total value", value: usd(totalValue) }), /* @__PURE__ */ React.createElement(
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
      const pct2 = totalValue ? alloc.byClass[k] / totalValue * 100 : 0;
      return pct2 > 0 && /* @__PURE__ */ React.createElement("span", { key: k, style: { width: `${pct2}%`, background: m.color }, title: `${m.label} ${pct2.toFixed(1)}%` });
    })), /* @__PURE__ */ React.createElement("div", { className: "vg-legend" }, Object.entries(ASSET_CLASSES).map(([k, m]) => {
      const pct2 = totalValue ? alloc.byClass[k] / totalValue * 100 : 0;
      const drift = pct2 - ALLOCATION_TARGETS[k];
      return /* @__PURE__ */ React.createElement("span", { key: k }, /* @__PURE__ */ React.createElement("span", { className: "sw", style: { background: m.color } }), m.label, " ", /* @__PURE__ */ React.createElement("span", { className: "num" }, pct2.toFixed(1), "%"), " ", accountId === "all" && Math.abs(drift) >= 3 && /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", drift > 0 ? "warn" : "info") }, signPct(drift, 1), " vs target"));
    }))), /* @__PURE__ */ React.createElement("div", { className: "vg-grid2", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Top actions"), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => go("recs") }, "All recommendations \u2192")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, display: "grid", gap: 10 } }, /* @__PURE__ */ React.createElement(SecurityCard2, { accent: "teal", title: `Harvest IWM \u2192 \u2248 ${usd(1513 * settings.taxRate / 100)} benefit` }, "Clear in all 4 accounts. Replace with IJR to keep exposure."), /* @__PURE__ */ React.createElement(SecurityCard2, { accent: "orange", title: "Pause Jul VOO auto-buy" }, "Wealthfront's auto-invest is washing the Fidelity VOO loss."))), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Latest alerts"), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setNotifOpen(true) }, "Open inbox \u2192")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10 } }, recent.map((n) => /* @__PURE__ */ React.createElement("div", { key: n.id, className: cls("vg-notif", !n.read && "unread"), style: { cursor: "default" } }, !n.read && /* @__PURE__ */ React.createElement("span", { className: "vg-dot" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "t" }, NOTIF_TYPES[n.type].icon, " ", n.title), /* @__PURE__ */ React.createElement("div", { className: "when" }, n.time, " \xB7 ", NOTIF_TYPES[n.type].label))))))));
  }
  function HoldingsView({ accountId, settings, setAnalysisSym }) {
    const [expanded, setExpanded] = useState3({});
    const posFixture = useMemo3(() => positions(accountId), [accountId]);
    const pos = useLive(() => positions2(accountId).then(mapPositions), posFixture, [accountId, settings]).data;
    const acctLabel = accountId === "all" ? "All accounts" : acctOf(accountId).name;
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Holdings"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, acctLabel, " \xB7 ", pos.filter((p) => p.symbol !== "CASH").length, " positions \xB7 click a row for per-lot detail"), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Symbol"), /* @__PURE__ */ React.createElement("th", null, "Accounts"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Value"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Day"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Weight"), /* @__PURE__ */ React.createElement("th", null, "Flags"))), /* @__PURE__ */ React.createElement("tbody", null, pos.map((p) => {
      const opt = isOptionSym(p.symbol);
      const sleeve = p.symbol === "CRYPTO" || p.symbol === "FUTURES";
      const noDay = p.symbol === "CASH" || (opt || sleeve) && !p.dayPl;
      return /* @__PURE__ */ React.createElement(React.Fragment, { key: p.symbol }, /* @__PURE__ */ React.createElement("tr", { className: "click", onClick: () => setExpanded((e) => ({ ...e, [p.symbol]: !e[p.symbol] })) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, p.symbol === "CASH" ? "Cash" : p.symbol), opt && /* @__PURE__ */ React.createElement("span", { className: "vg-chip", style: { marginLeft: 6 }, title: "option contract" }, "OPT"), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, (MARKET[p.symbol] || {}).name || (sleeve ? "sleeve \u2014 value via Robinhood portfolio" : ""))), /* @__PURE__ */ React.createElement("td", null, [...p.accounts].map((id) => /* @__PURE__ */ React.createElement("span", { className: "vg-chip", key: id }, acctOf(id).short))), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(p.value)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(p.dayPl)) }, noDay ? "\u2014" : signUsd(p.dayPl)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(p.unrl)) }, p.symbol === "CASH" ? "\u2014" : signUsd(p.unrl)), /* @__PURE__ */ React.createElement("td", { className: "num" }, p.weight.toFixed(1), "%"), /* @__PURE__ */ React.createElement("td", null, p.overlap && accountId === "all" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info", title: `Held as ${p.overlap.symbols.join(", ")}` }, "Overlap: ", p.overlap.label), p.symbol !== "CASH" && !sleeve && p.weight > 7 && ((MARKET[p.symbol] || {}).name || "").indexOf("ETF") === -1 && /* @__PURE__ */ React.createElement("span", { className: "vg-badge warn" }, "Concentrated"))), expanded[p.symbol] && p.lots.map((l, i) => /* @__PURE__ */ React.createElement("tr", { className: "vg-subrow", key: i }, /* @__PURE__ */ React.createElement("td", { style: { paddingLeft: 26 } }, "lot \xB7 ", fmtDate(l.date)), /* @__PURE__ */ React.createElement("td", null, acctOf(l.account).short), /* @__PURE__ */ React.createElement("td", { className: "num" }, usd(lotValue(l))), /* @__PURE__ */ React.createElement("td", { className: "num" }, l.symbol === "CASH" ? "\u2014" : `${l.shares} sh @ ${usd(l.costPerShare, 2)}`), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(lotUnrl(l))) }, l.symbol === "CASH" ? "\u2014" : signUsd(lotUnrl(l))), /* @__PURE__ */ React.createElement("td", { className: "num", colSpan: 2 }, l.symbol === "CASH" ? "" : `${daysAgo(l.date) > 365 ? "long-term" : "short-term"}`))));
    })))));
  }
  var ACTIVITY_PAGE = 50;
  var ACTIVITY_KINDS = [
    { id: "all", label: "All" },
    { id: "equity", label: "Equities" },
    { id: "option", label: "Options" }
  ];
  function fmtWhen(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return { day: iso ? String(iso) : "\u2014", time: "" };
    return {
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    };
  }
  function ActivityView({ accountId, settings }) {
    const [kind, setKind] = useState3("all");
    const [shown, setShown] = useState3(ACTIVITY_PAGE);
    const rows = useLive(
      () => getHistory(accountId).then(mapHistory),
      null,
      [accountId, settings]
    ).data;
    useEffect3(() => {
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
      const w = fmtWhen(r.date);
      return /* @__PURE__ */ React.createElement("tr", { key: i, style: r.state === "cancelled" ? { opacity: 0.55 } : void 0 }, /* @__PURE__ */ React.createElement("td", null, w.day, w.time && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, w.time)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, acctOf(r.account).short)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, r.symbol || "\u2014"), r.kind === "option" && /* @__PURE__ */ React.createElement("span", { className: "vg-chip", style: { marginLeft: 6 }, title: "option contract" }, "OPT"), r.description && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, r.description)), /* @__PURE__ */ React.createElement("td", null, r.side === "buy" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "Buy"), r.side === "sell" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "Sell"), r.side !== "buy" && r.side !== "sell" && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.qty != null ? r.qty : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, r.price != null ? usd(r.price, 2) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(r.amount || 0)) }, r.amount != null ? signedAmt(r.amount) : "\u2014"), /* @__PURE__ */ React.createElement("td", null, r.state === "filled" && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5 } }, "filled"), r.state === "open" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "open"), r.state === "cancelled" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "cancelled"), r.state && !["filled", "open", "cancelled"].includes(r.state) && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, r.state), !r.state && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "\u2014")));
    })))), filtered.length > shown && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 10 } }, /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => setShown(shown + ACTIVITY_PAGE) }, "Show ", Math.min(ACTIVITY_PAGE, filtered.length - shown), " more \xB7 ", filtered.length - shown, " remaining"))));
  }
  function TaxView({ settings, tlh: tlh2 }) {
    const [washFaqOpen, setWashFaqOpen] = useState3(false);
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Tax Center \u2014 loss harvesting"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Every lot marked to last close \xB7 wash-sale window checked across ", /* @__PURE__ */ React.createElement("b", null, "all ", ACCOUNTS.length, " accounts"), " \xB7 threshold ", usd(settings.thresholdUsd), " or ", settings.thresholdPct, "% \xB7 decision-support only, no orders placed"), /* @__PURE__ */ React.createElement("div", { className: "vg-card vg-tablewrap", style: { padding: "8px 12px" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Lot"), /* @__PURE__ */ React.createElement("th", null, "Account"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Unrealized"), /* @__PURE__ */ React.createElement("th", null, "Status"), /* @__PURE__ */ React.createElement("th", null, "Action"))), /* @__PURE__ */ React.createElement("tbody", null, tlh2.map((c, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, c.lot.symbol), " \xB7 ", c.lot.shares, " sh @ ", usd(c.lot.costPerShare, 2), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "bought ", fmtDate(c.lot.date))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "vg-chip" }, c.acct.short)), /* @__PURE__ */ React.createElement("td", { className: "num down" }, signUsd(c.unrl), " ", /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "(", signPct(-c.lossPct), ")")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u2713 Clear to harvest"), c.status === "blocked" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Wash-sale blocked"), c.status === "below" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "Below threshold"), c.status === "na" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "N/A \u2014 tax-advantaged"), c.status === "blocked" && /* @__PURE__ */ React.createElement("div", { className: "vg-note", style: { maxWidth: 320, marginTop: 4 } }, c.wash.reason, ". Clears ", c.wash.clearsOn === "auto-buy paused" ? "once the auto-buy is paused" : c.wash.clearsOn, ".")), /* @__PURE__ */ React.createElement("td", null, c.status === "clear" && (c.replacement ? /* @__PURE__ */ React.createElement("span", null, "Sell \u2192 buy ", /* @__PURE__ */ React.createElement("b", null, c.replacement), " ", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "different index, near-identical exposure")) : /* @__PURE__ */ React.createElement("span", null, "Sell, wait 31 days to rebuy", /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, "no like-exposure partner for single stock"))), c.status === "blocked" && c.wash.futureRisk && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Pause ", c.wash.futureRisk.symbol, " auto-buy to open a window"), (c.status === "below" || c.status === "na") && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Monitor"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement(
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
      const wash = a.washBlocked ? " \xB7 WASH BLOCKED" : "";
      return `${loss}${weeks}${wash}`;
    }
    return d.rationale || "";
  }
  function tfTrend(perTf, name) {
    const tf = perTf && perTf[name];
    if (!tf || !tf.trend) return `${name}: \u2014`;
    return `${name}: ${tf.trend.direction} (${tf.trend.structure})`;
  }
  function RecRow({ d, onJump }) {
    const [open, setOpen] = useState3(false);
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
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Recommendations"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "Persisted decision journal", data && data.asOf ? ` \xB7 as of ${data.asOf}` : "", " \xB7 actionable first \xB7 educational only, not advice"), sorted.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "No analysis available"), /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { margin: "6px 0 0" } }, "The decision journal is empty or the backend is unreachable. Run the nightly analysis (", /* @__PURE__ */ React.createElement("code", null, "python -m vantage_server.analyze"), ") and confirm the backend URL in Settings.")) : /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 8, padding: 0, overflowX: "auto" } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table", style: { width: "100%", borderCollapse: "collapse" } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left", fontSize: 12, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Symbol"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Conviction"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Recommendation"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px" } }, "Detail"), /* @__PURE__ */ React.createElement("th", { style: { padding: "10px 14px", textAlign: "right" } }))), /* @__PURE__ */ React.createElement("tbody", null, sorted.map((d) => /* @__PURE__ */ React.createElement(RecRow, { key: d.symbol, d, onJump: jump }))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 2 } }, "Options income"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "Executable covered-call ideas on your book \u2014 see Options Intelligence.")), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => go("options") }, "Open Options Intel \u2192"))));
  }
  function MarketsView({ symbol, setSymbol, setAnalysisSym, go, settings }) {
    const [signalsTab, setSignalsTab] = useState3("active");
    const miraOn = settings.aiBackend === "mira";
    const insights = useLive(() => miraOn ? getInsights() : null, null, [settings]);
    const report = insights.data;
    const signals = useLive(() => getSignals().then(mapSignals), SIGNALS, [settings]).data;
    const isPastSignal = (s) => s.status === "hit-target" || s.status === "stopped";
    return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h2", { style: { margin: 0, fontSize: 19 } }, "Market intelligence"), /* @__PURE__ */ React.createElement("p", { className: "vg-sub" }, "AI-generated market read \xB7 educational only, not trade recommendations"), /* @__PURE__ */ React.createElement("div", { className: "vg-card" }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, Object.keys(AI_INSIGHTS).map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: cls("vg-pill", symbol === s && "sel"), onClick: () => setSymbol(s) }, s))), /* @__PURE__ */ React.createElement("div", { className: "vg-row" }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", AI_INSIGHTS[symbol].bias) }, AI_INSIGHTS[symbol].bias), /* @__PURE__ */ React.createElement("button", { className: "vg-linkbtn", onClick: () => go("charts") }, "Open on AI Charts \u2192"))), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14.5, lineHeight: 1.55, margin: "14px 0" } }, AI_INSIGHTS[symbol].summary), /* @__PURE__ */ React.createElement("div", { className: "vg-grid2" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 12.5, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, "Momentum"), /* @__PURE__ */ React.createElement("span", null, AI_INSIGHTS[symbol].momentum, "/100")), /* @__PURE__ */ React.createElement("div", { className: "vg-meter" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${AI_INSIGHTS[symbol].momentum}%` } }))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { fontSize: 12.5, color: "var(--color-grey)" } }, /* @__PURE__ */ React.createElement("span", null, "Sentiment"), /* @__PURE__ */ React.createElement("span", null, AI_INSIGHTS[symbol].sentiment, "/100")), /* @__PURE__ */ React.createElement("div", { className: "vg-meter" }, /* @__PURE__ */ React.createElement("span", { style: { width: `${AI_INSIGHTS[symbol].sentiment}%`, background: "var(--color-secondary)" } }))))), report ? /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Mira advisor insights"), /* @__PURE__ */ React.createElement("span", { className: "vg-row" }, /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u25CF live"), report.confidence != null && /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "confidence ", report.confidence))), report.summary && /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, lineHeight: 1.55, margin: "12px 0" } }, report.summary), Array.isArray(report.observations) && report.observations.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap" }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("tbody", null, report.observations.map((o, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", { style: { width: 140 } }, /* @__PURE__ */ React.createElement("b", null, o.topic)), /* @__PURE__ */ React.createElement("td", null, o.detail, o.evidence && /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, o.evidence))))))), report.caveats && (Array.isArray(report.caveats) ? report.caveats.length > 0 : true) && /* @__PURE__ */ React.createElement("p", { className: "vg-note", style: { marginTop: 8 } }, Array.isArray(report.caveats) ? report.caveats.join(" \xB7 ") : String(report.caveats))) : /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker" }, "Today's AI picks"), /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap" }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("tbody", null, AI_PICKS.map((p) => /* @__PURE__ */ React.createElement("tr", { key: p.sym, className: "click", onClick: () => AI_INSIGHTS[p.sym] && setSymbol(p.sym) }, /* @__PURE__ */ React.createElement("td", { style: { width: 70 } }, /* @__PURE__ */ React.createElement("b", null, p.sym)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", p.stance), style: { fontSize: 12 } }, p.stance)), /* @__PURE__ */ React.createElement("td", { className: "vg-note" }, p.note), /* @__PURE__ */ React.createElement("td", { className: "num", style: { width: 90 } }, p.conf, "% conf"))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread" }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "AI pattern signals"), /* @__PURE__ */ React.createElement("div", { className: "vg-pills" }, /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", signalsTab === "active" && "sel"), onClick: () => setSignalsTab("active") }, "Active (", signals.filter((s) => !isPastSignal(s)).length, ")"), /* @__PURE__ */ React.createElement("button", { className: cls("vg-pill", signalsTab === "past" && "sel"), onClick: () => setSignalsTab("past") }, "Past (", signals.filter(isPastSignal).length, ")"))), /* @__PURE__ */ React.createElement("div", { className: "vg-tablewrap", style: { marginTop: 10 } }, /* @__PURE__ */ React.createElement("table", { className: "vg-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Ticker"), /* @__PURE__ */ React.createElement("th", null, "Pattern"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Entry"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Target"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Stop"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Move"), /* @__PURE__ */ React.createElement("th", { className: "num" }, "Conf"), /* @__PURE__ */ React.createElement("th", null, "Status"))), /* @__PURE__ */ React.createElement("tbody", null, signals.filter((s) => signalsTab === "active" ? !isPastSignal(s) : isPastSignal(s)).map((s) => /* @__PURE__ */ React.createElement("tr", { key: s.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("b", null, s.sym), /* @__PURE__ */ React.createElement("div", { className: "vg-note" }, s.time)), /* @__PURE__ */ React.createElement("td", null, s.pattern), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.entry.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.target.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.stop.toFixed(2)), /* @__PURE__ */ React.createElement("td", { className: cls("num", dirCls(s.movePct || 0)) }, s.movePct != null ? signPct(s.movePct, 1) : "\u2014"), /* @__PURE__ */ React.createElement("td", { className: "num" }, s.conf != null ? `${s.conf}%` : "\u2014"), /* @__PURE__ */ React.createElement("td", null, s.status === "active" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge good" }, "\u25CF Active"), s.status === "hit-target" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "\u2713 Hit target"), s.status === "stopped" && /* @__PURE__ */ React.createElement("span", { className: "vg-badge bad" }, "\u2715 Stopped"), s.status === "unquoted" && /* @__PURE__ */ React.createElement(
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
    )))))))), /* @__PURE__ */ React.createElement("div", { className: "vg-card", style: { marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-spread", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { className: "vg-kicker", style: { marginBottom: 0 } }, "Sector heatmap \u2014 S&P 100, 1-day change"), /* @__PURE__ */ React.createElement("span", { className: "vg-note" }, "green = up \xB7 red = down \xB7 click a stock for detail")), /* @__PURE__ */ React.createElement("div", { className: "vg-heat" }, SECTORS.map((sec) => /* @__PURE__ */ React.createElement("div", { className: "vg-heat-sector", key: sec.name }, /* @__PURE__ */ React.createElement("h4", null, sec.name, /* @__PURE__ */ React.createElement("span", { style: { color: sec.pct >= 0 ? "var(--vg-success-deep)" : "var(--vg-danger)" } }, signPct(sec.pct))), /* @__PURE__ */ React.createElement("div", { className: "vg-heat-tiles" }, sec.stocks.map((st) => /* @__PURE__ */ React.createElement(
      "button",
      {
        key: st.sym,
        className: "vg-heat-tile",
        style: { background: heatTint(st.pct) },
        onClick: () => setAnalysisSym(st)
      },
      /* @__PURE__ */ React.createElement("div", { className: "s" }, st.sym),
      /* @__PURE__ */ React.createElement("div", { className: "p" }, signPct(st.pct))
    ))))))));
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
    const [msgs, setMsgs] = useState3([
      { who: "ai", text: "Hi \u2014 I'm Vantage AI. I can see across all 4 of your linked accounts. Ask me about harvesting, wash sales, overlap, or your allocation." }
    ]);
    const [draft, setDraft] = useState3("");
    const [busy, setBusy] = useState3(false);
    const bodyRef = useRef2(null);
    const abortRef = useRef2(null);
    useEffect3(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, [msgs]);
    useEffect3(() => () => {
      if (abortRef.current) abortRef.current();
    }, []);
    const patchLast = (fn) => setMsgs((m) => m.map((x, i) => i === m.length - 1 ? fn(x) : x));
    const cannedReply = (text) => CHAT_RULES.find((r) => r.match.test(text)).reply;
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
  function SettingsModal({ settings, onSave, onClose }) {
    const [draft, setDraft] = useState3(settings);
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
  function AnalysisModal({ stock, onClose }) {
    const insight = AI_INSIGHTS[stock.sym];
    const held = LOTS.filter((l) => l.symbol === stock.sym);
    const [why, setWhy] = useState3(false);
    return /* @__PURE__ */ React.createElement(Modal, { title: `${stock.sym} \u2014 analysis`, open: true, onClose }, /* @__PURE__ */ React.createElement("div", { className: "vg-row", style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { className: cls("vg-badge", stock.pct >= 0 ? "good" : "bad") }, signPct(stock.pct), " today"), insight && /* @__PURE__ */ React.createElement("span", { className: cls("vg-bias", insight.bias), style: { fontSize: 12 } }, insight.bias), held.length > 0 ? /* @__PURE__ */ React.createElement("span", { className: "vg-badge info" }, "You hold this in ", [...new Set(held.map((l) => acctOf(l.account).short))].join(", ")) : /* @__PURE__ */ React.createElement("span", { className: "vg-badge plain" }, "Not held")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 14, lineHeight: 1.5 } }, insight ? insight.summary : `No AI note for ${stock.sym} in this demo \u2014 showing market context only. Sector move ${signPct(stock.pct)} on the day.`), /* @__PURE__ */ React.createElement(FAQItem3, { question: "How is this rating generated?", open: why, onToggle: () => setWhy(!why) }, "In the real product this blends trend, momentum, volume and options-flow features into a single bias score. In this prototype it is illustrative mock data \u2014 educational only, never trading advice."));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
})();
