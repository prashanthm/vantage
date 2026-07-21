// Plain-English glossary for the trading screens. One place to define what the
// jargon means so the SPX playbook and Futures pages can explain themselves —
// hover a term for a one-liner, or read the collapsible glossary card.
import { cls } from "./util.jsx";

// term key -> { label (display), short (hover one-liner), long (glossary card) }
export const GLOSSARY = {
  positive_gamma: {
    label: "positive gamma",
    short: "Dealers hedge AGAINST moves — they sell rallies and buy dips, which dampens the market into a range.",
    long: "Options dealers hedge to stay neutral. In POSITIVE gamma their hedging works against the move — selling into strength, buying into weakness — so it acts like a shock absorber and pins price into a range. (Negative gamma is the opposite: hedging amplifies moves, giving trend days.)",
  },
  negative_gamma: {
    label: "negative gamma",
    short: "Dealers hedge WITH the move — selling into drops, buying into rallies — so moves accelerate (trend/crash days).",
    long: "The dangerous regime: dealer hedging adds to the move (sell into declines, buy into rallies), so intraday moves get amplified. Trend days and fast selloffs live here — you go WITH the move, not against it.",
  },
  mean_reversion: {
    label: "mean-reversion",
    short: "Price tends to snap back toward the middle instead of trending — so fade the edges.",
    long: "'Mean reversion' means price tends to return toward the middle of its range rather than running one direction. On a positive-gamma day the dealer hedging keeps pulling price back, so the day chops in a range — you fade the extremes (sell rallies, buy dips) instead of chasing breakouts.",
  },
  fade: {
    label: "fade",
    short: "Bet AGAINST the current move — sell into a rally, buy into a dip, expecting a reversal.",
    long: "To 'fade' a move is to trade the opposite direction, expecting it to reverse. Fade a rally = sell/short as price rises into resistance. Fade a dip = buy as price falls into support. It's the core tactic on a mean-reversion (positive-gamma) day.",
  },
  gamma_flip: {
    label: "gamma flip",
    short: "The price line where the regime flips: above = calm/range, below = fast/trending.",
    long: "The spot level where net dealer gamma crosses zero. Above the flip you're in the calm, range-bound (positive-gamma) regime; a break below flips it to the fast, momentum (negative-gamma) regime. It's the single most important line to watch.",
  },
  call_wall: {
    label: "call wall",
    short: "The strike with the most call gamma above spot — rallies tend to stall here.",
    long: "The strike above spot with the largest dealer call-gamma. Dealer re-hedging is heaviest here, so rallies often slow or reverse at the call wall. A magnet/brake, not a guarantee.",
  },
  put_wall: {
    label: "put wall",
    short: "The strike with the most put gamma below spot — dips tend to get bought here.",
    long: "The strike below spot with the largest dealer put-gamma. Dips often find support at the put wall as dealer hedging kicks in. A magnet/brake, not a guarantee.",
  },
  max_pain: {
    label: "max pain",
    short: "The strike where the most options expire worthless — price often drifts toward it.",
    long: "The strike that minimizes total payout to option holders at expiry. Price sometimes drifts toward max pain into an expiration as positioning unwinds — a soft magnet, weakest of the GEX levels.",
  },
  confluence: {
    label: "confluence",
    short: "A price where 2+ independent levels stack — a stronger spot than any one alone.",
    long: "A band where two or more different level types line up (e.g. a fib level + a support shelf + a wall). Stacked levels reinforce each other, so confluence zones react more reliably than a single level. Marked ✦.",
  },
  // ---- futures metrics ----
  expectancy: {
    label: "expectancy",
    short: "Your average profit/loss PER TRADE — the number that says if the system makes money.",
    long: "Win% × average win − loss% × average loss. It's what you make per trade on average. Positive = the system prints money over time even with losses; negative = it bleeds regardless of win rate. The single most important edge metric.",
  },
  reward_risk: {
    label: "reward : risk",
    short: "How big your average winner is vs your average loser. Below ~1.5 means winners barely beat losers.",
    long: "Average win ÷ average loss (in points, so a micro and a mini aren't conflated). A 54% win rate with 1.1 R:R barely pays; the same win rate at 2.0 R:R is strong. Raising your targets (or cutting losers sooner) improves this.",
  },
  profit_factor: {
    label: "profit factor",
    short: "Gross profit ÷ gross loss. Above 1 = profitable; 1.5+ is solid.",
    long: "Total dollars won ÷ total dollars lost. 1.0 = breakeven, above 1 = profitable, 1.5+ is a healthy system. Complements expectancy — it tells you how much cushion your winners give over your losers.",
  },
  drawdown: {
    label: "drawdown",
    short: "The biggest drop from a peak in your running P&L — how deep it dug before recovering.",
    long: "The largest peak-to-trough fall in your cumulative equity. It's the pain you'd have felt at the worst point. A big drawdown relative to total profit is a risk-management red flag even if you ended up green.",
  },
  win_rate: {
    label: "win rate",
    short: "The % of trades that were profitable. High win rate alone doesn't mean profitable — reward:risk matters too.",
    long: "Share of round-trips that made money. On its own it's misleading: a 40%-win system with big winners beats an 80%-win system with tiny winners that gives it all back on the losers. Read it alongside reward:risk and expectancy.",
  },
  reclaim: {
    label: "reclaim",
    short: "Don't enter when price TOUCHES the level — wait for 3 consecutive 5-minute closes back through it first.",
    long: "The entry discipline Vantage's backtesting program validated. Buying the instant price touches support gets stopped out by the routine overshoot ('catching a falling knife') — it lost in every regime tested, and beat the touch-entry in all 36 months of a 3-year validation. Instead, let price touch or pierce the level, then wait for THREE consecutive 5-minute candles to close back on your side of it (~15 rolling minutes of confirmation). Enter on that third close. You pay a slightly worse price and skip the days that never reclaim — those are precisely the trades that were going to lose.",
  },
};

// <Term k="fade">fade</Term> — a dotted-underline word that shows the plain
// definition on hover (native title tooltip; works everywhere, no JS needed).
export function Term({ k, children }) {
  const g = GLOSSARY[k];
  if (!g) return children || null;
  return (
    <span className="vg-term" title={g.short}
      style={{ borderBottom: "1px dotted currentColor", cursor: "help" }}>
      {children || g.label}
    </span>
  );
}

// A collapsible glossary card listing the given term keys with full definitions.
export function GlossaryCard({ terms, title = "What these terms mean" }) {
  const items = (terms || []).map((k) => GLOSSARY[k]).filter(Boolean);
  if (!items.length) return null;
  return (
    <details className="vg-card">
      <summary className="vg-kicker" style={{ cursor: "pointer" }}>{title}</summary>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {items.map((g, i) => (
          <div key={i} style={{ fontSize: 14, lineHeight: 1.5 }}>
            <b>{g.label}</b> — {g.long}
          </div>
        ))}
      </div>
    </details>
  );
}
