// Journal domain logic, ported VERBATIM from src/journal.jsx (W5). This file
// is the part that must not drift: the thought encoding, the operator-intent
// inference, and the analyst prompt are the contract with Mira's
// trade_analyst — same strings in, same reviews out, both shells.
import { getTradeDna, saveTradeAnalysis } from "./journal_api.js";
import { collectTurn } from "./stream.js";

// persisted per-trade thought: "@<entry>[/<exit>][~<structure>]|<why>"
export const THOUGHT_RE = /^@([\d.]*)(?:\/([\d.]*))?(?:~([^|]*))?\|/;

export function operatorFor(t, thought) {
  const m = (thought || "").match(THOUGHT_RE) || [];
  const why = (thought || "").replace(THOUGHT_RE, "");
  const corr = t.correlation, exitCorr = t.exit_correlation;
  const nearest = corr && corr.nearest, exitNearest = exitCorr && exitCorr.nearest;
  const autoEntry = (corr && corr.at_level && nearest) ? String(nearest.level) : null;
  const autoExit = (exitCorr && exitCorr.at_level && exitNearest) ? String(exitNearest.level) : null;
  return {
    why,
    entryTag: m[1] || autoEntry, exitTag: m[2] || autoExit,
    structTag: m[3] || null,
    entryTagAuto: !m[1] && !!autoEntry, exitTagAuto: !m[2] && !!autoExit,
  };
}

export function encodeThought(e, x, s, w) {
  if (!e && !x && !s) return w;
  return `@${e || ""}${x ? `/${x}` : ""}${s ? `~${s}` : ""}|${w}`;
}

// Turn the structured DNA into the analyst brief (verbatim port — this string
// IS the interface to Mira's trade_analyst).
export function buildAnalystPrompt(dna, operator, session) {
  const j = (o) => JSON.stringify(o);
  const e = dna.entry, x = dna.exit;
  const { why, entryTag, exitTag, structTag } = operator || {};
  const win = (w) => (w || []).map((b) =>
    `  ${b.time}  O${b.open} H${b.high} L${b.low} C${b.close}  vol ${b.volume}${b.at_fill ? "  «FILL»" : ""}`).join("\n");
  const operatorBlock = [];
  if (why) operatorBlock.push(`- Their stated reasoning: "${why}"`);
  if (entryTag) operatorBlock.push(`- They say they entered on the ${entryTag} level.`);
  if (exitTag) operatorBlock.push(`- They say they exited on the ${exitTag} level.`);
  if (structTag) operatorBlock.push(
    `- They say the STRUCTURE they traded off was: "${structTag}". This is their declared setup — evaluate the trade AGAINST it, not as an unplanned entry: was that structure real and adjacent at the fill (cross-check the ICT block above), was trading it in this direction coherent, and did it hold or fail? If the entry price/timing is inconsistent with actually trading that structure, say so.`);

  return [
    `Review this options trade AND critique the operator's own reasoning against the tape, the technicals, and best practice. Be a demanding desk mentor — validate what was sound, call out what was wrong or lucky. All the DNA is below; use ONLY these numbers.`,
    ``,
    `TRADE: ${dna.label} (${dna.strategy}), a ${dna.timeframe} on ${dna.underlying}. Opened ${dna.opened_at}, closed ${dna.closed_at}. Realized P&L $${dna.realized}.`,
    dna.coarse ? `Note: price action is 15-minute bars (1-minute unavailable this far back).` : ``,
    dna.scale ? `THIS WAS A SCALED POSITION (${dna.scale.peak_contracts}× peak): ${dna.scale.entries} entries at avg $${dna.scale.avg_entry}, ${dna.scale.exits} exits at avg $${dna.scale.avg_exit}${dna.scale.add_behavior ? `, ${dna.scale.add_behavior}` : ""}${dna.scale.exit_style ? `, ${dna.scale.exit_style}` : ""}. The full fill ladder (time/side/price/running position): ${j(dna.fills)}. JUDGE THE SCALING — adding on strength vs averaging down, laddering the exit vs one-shot, and whether the geometry was disciplined or hope.` : ``,
    ``,
    `THE FORECAST for the session (levels the operator planned around): ${j(dna.forecast_levels)}. GEX anchors: ${j(dna.gex_anchors)}.`,
    dna.standing_forecast ? [
      ``,
      `THE STANDING ANALYST FORECAST when this trade was entered (made ${dna.standing_forecast.age_min_at_entry} min before entry, at ${dna.underlying} ${dna.standing_forecast.price_at}): bias ${dna.standing_forecast.bias || "?"}, target ${dna.standing_forecast.target ?? "—"}, invalidation ${dna.standing_forecast.invalidation ?? "—"}${dna.standing_forecast.born_invalid ? " — NOTE: this forecast was flagged BORN-INVALID (issued beyond its own invalidation)" : ""}${dna.standing_forecast.score_verdict ? `. It was later scored: ${dna.standing_forecast.score_verdict}` : ""}.`,
      `JUDGE THE ALIGNMENT: did the operator trade WITH or AGAINST the standing forecast? Given how both resolved, which of them read the tape right — and should the operator have weighted the forecast more or less?`,
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
      `ICT STRUCTURE AT ENTRY (deterministic engine, time-anchored to the fill): draw ${j(dna.ict.draw)} · flags ${j(dna.ict.flags)} · hourly setup ${j(dna.ict.htf_setup)}.`,
      dna.ict.entry_context ? `FVGs ADJACENT TO THE ENTRY PRICE (${dna.ict.entry_context.entry_price}, ±${dna.ict.entry_context.tol_pct}%) by timeframe: ${j(dna.ict.entry_context.fvgs_at_entry)}. RECENT HOURLY LIQUIDITY SWEEPS before entry (wick through a swing, close back): ${j(dna.ict.entry_context.htf_sweeps)}.` : ``,
      `WEIGH THIS STRUCTURE: was the entry into/off an adjacent FVG, and did it follow an HTF sweep? Say whether the structure supported or fought this entry — as context alongside the tape, not as a signal by itself (level/FVG adjacency has no standalone backtested edge here).`,
    ].filter(Boolean).join("\n") : ``,
    ``,
    dna.news ? `NEWS & SENTIMENT for ${dna.news.symbol} that session (sentiment is an ESTIMATED lexicon lean over headlines, not ground truth — cite it as such): ${j(dna.news)}.` : `No news available for the session.`,
    ``,
    operatorBlock.length
      ? `THE OPERATOR'S OWN VIEW — critique this directly against the data above:\n${operatorBlock.join("\n")}`
      : `The operator left no note on their thinking — flag that journaling the WHY would let this review critique the reasoning, not just the result.`,
    ``,
    `Write a tight desk review, specific with the numbers:`,
    `1. ENTRY quality — bought strength or caught a knife? At a real level? What did volume/VWAP say?`,
    `2. EXIT quality — sold a spike or gave it back? At a level? Extended (VWAP/RSI)?`,
    `3. RESPECT THE PLAN — enter/exit at forecast levels, in line with the tape?`,
    `4. CRITIQUE THE OPERATOR'S REASONING — does their stated why (and the levels they claim they traded) hold up against what the tape and technicals actually did? Were they right for the right reasons, right for the wrong reasons, or wrong? If their tagged level doesn't match the DNA's nearest level, say so.`,
    `5. NEWS/SENTIMENT — did the session's news context support or undercut this trade? Any risk they ignored?`,
    `6. One concrete LESSON — the single most useful thing to do differently.`,
    `Be direct and demanding. No disclaimers.`,
    ``,
    `Return ONLY a JSON object (no prose outside it, no code fences) in this shape:`,
    `{"headline":"<one-line verdict on the trade>","sections":[`,
    `  {"kind":"keyvals","title":"Entry & exit","rows":[{"k":"Entry","v":"<quality read, cite the numbers>","tone":"good|bad|warn"},{"k":"Exit","v":"<quality read>","tone":"good|bad|warn"}]},`,
    `  {"kind":"list","title":"Plan & reasoning","items":[{"point":"<did they respect forecast levels / the tape>"},{"point":"<critique of their stated why vs the data>"}]},`,
    `  {"kind":"callout","title":"News read","text":"<did session news support or undercut this>","tone":"good|bad|warn"},`,
    `  {"kind":"donext","items":[{"title":"<the one lesson>","detail":"<how to apply it>"}]}`,
    `]}`,
    `Every claim must use the numbers above. If you can't produce valid JSON, write the review as plain prose instead.`,
  ].filter((l) => l !== ``).join("\n");
}

// Run ONE trade's analysis end to end (DNA → prompt → model stream → save).
// Resolves {status:'saved'|'skipped'|'empty'|'error'}. Skips already-analyzed
// trades unless force.
export async function analyzeTradeOnce(day, tradeIndex, underlying, operator, { force = false, onChunk } = {}) {
  const res = await getTradeDna(day, tradeIndex, underlying);
  if (!res || !res.available || !res.dna) return { status: "error", note: (res && res.note) || "no DNA" };
  if (!force && res.stored && (res.stored.analysis || "").trim()) return { status: "skipped" };
  const prompt = buildAnalystPrompt(res.dna, operator || {}, res.playbook_session);
  const { text, error } = await collectTurn(prompt, `trade-${day}-${tradeIndex}`, { onToken: onChunk });
  if (error && !text) return { status: "error", note: error };
  if (text.trim() && res.trade_key) {
    saveTradeAnalysis({ day, trade_key: res.trade_key, underlying,
      label: res.dna.label, dna: res.dna, analysis: text });
    return { status: "saved" };
  }
  return { status: "empty" };
}
