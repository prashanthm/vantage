// Trading Journal (W5) — the canonical record, ported last and carefully.
// Days tab: the day strip, every decision reconstructed from broker fills,
// the operator's why/level/structure tags (the @entry[/exit][~structure]|why
// encoding — byte-identical to the legacy shell so existing thoughts read
// back), per-trade Mira desk reviews, Analyze-today + the day synthesis.
// Analysis tab: the compounding window self-assessment with SWOT + history.
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Panel as Section } from "../templates.jsx";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Ledger } from "../templates.jsx";
import { links } from "../links.js";
import { money as fmtMoney } from "../api.js";
import { MiraView, SwotView, parseMira } from "../mira.jsx";
import { collectTurn } from "../stream.js";
import { THOUGHT_RE, operatorFor, encodeThought, buildAnalystPrompt, analyzeTradeOnce } from "../journal_logic.js";
import * as J from "../journal_api.js";

const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const fmtLvl = (v) => (v == null ? "—" : Number(v).toFixed(v >= 100 ? 0 : 2));
const money = fmtMoney;
const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dayOf = (s) => (s && s.created_at ? s.created_at.slice(0, 10) : "");

const inputStyle = {
  font: "inherit", padding: "5px 9px", borderRadius: 8, width: "100%",
  border: "1px solid var(--color-border)",
  background: "var(--color-background-surface)", color: "var(--color-text-primary)",
};

const ENTRY_FIELDS = [
  ["action", "Action taken", "e.g. bought 7550C, sold half at 7575"],
  ["entry", "Entry", "price / time / size you got in"],
  ["exit", "Exit", "price / time you got out"],
  ["result", "Result", "P&L, win/loss, R multiple"],
  ["lesson", "Lesson", "what to repeat or avoid next time"],
  ["notes", "Notes", "anything else"],
];

const STATUS_BADGE = {
  closed: ["neutral", "CLOSED"], open: ["warning", "OPEN"],
  expired_worthless: ["error", "EXPIRED · $0"], expired_settled: ["success", "EXPIRED ITM"],
  expired_unpriced: ["warning", "EXPIRED"],
};

function dayTone(snap) {
  const sc = snap && snap.scorecard;
  if (!sc) return null;
  const regimeOk = sc.regime ? sc.regime.correct : null;
  const lvl = sc.level_accuracy;
  if (regimeOk === true && (lvl == null || lvl >= 0.5)) return "good";
  if (regimeOk === false || (lvl != null && lvl < 0.34)) return "bad";
  return "warn";
}

// ── the day strip ────────────────────────────────────────────────────────────
function DayStrip({ byDay, selDay, onSelect }) {
  const [pnl, setPnl] = useState({});
  const days = useMemo(() => {
    const out = [];
    const d = new Date();
    while (out.length < 14) {
      const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(d);
      if (wd !== "Sat" && wd !== "Sun")
        out.unshift(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d));
      d.setDate(d.getDate() - 1);
    }
    return out;
  }, []);
  useEffect(() => {
    let live = true;
    J.getDayPnl(days).then((v) => { if (live && v && v.pnl) setPnl(v.pnl); }).catch(() => {});
    return () => { live = false; };
  }, [days.join(",")]);
  const short = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(1) + "k" : Math.abs(n).toFixed(0)}`;
  const today = todayISO();
  return (
    <HStack gap={1} wrap="wrap" align="center">
      {days.map((iso) => {
        const p = pnl[iso];
        const traded = p && p.trades > 0;
        const sel = iso === selDay;
        return (
          <button key={iso} onClick={() => onSelect(iso)}
            style={{ ...inputStyle, width: "auto", cursor: "pointer", textAlign: "center",
              borderColor: sel ? "var(--color-text-primary)" : "var(--color-border)",
              background: sel ? "color-mix(in srgb, currentColor 8%, transparent)" : "var(--color-background-surface)" }}>
            <Text type="supporting" color="secondary">{iso === today ? "Today" : iso.slice(5)}</Text>
            {traded
              ? <Text type="supporting" weight="semibold"
                  color={p.realized >= 0 ? "success" : "error"}> {short(p.realized)}</Text>
              : null}
          </button>
        );
      })}
      <input type="date" style={{ ...inputStyle, width: "auto" }} value={selDay} max={today}
        onChange={(e) => e.target.value && onSelect(e.target.value)} aria-label="Jump to a day" />
    </HStack>
  );
}

// ── one side of the correlation ──────────────────────────────────────────────
function CorrList({ title, corr, openSpace }) {
  const nearest = corr && corr.nearest;
  return (
    <VStack gap={0}>
      <Text type="supporting" color="secondary" weight="semibold">{title}</Text>
      {corr && corr.nearby && corr.nearby.length ? corr.nearby.map((c, i) => (
        <Text key={i} type="supporting" weight={nearest && c.level === nearest.level ? "semibold" : undefined}>
          {fmtLvl(c.level)} · {c.role}{(c.kinds || []).length ? ` (${c.kinds.join(" + ")})` : ""}
          <Text type="supporting" color="secondary"> [{c.source}] {c.distance > 0 ? "+" : ""}{c.distance}pt</Text>
        </Text>
      )) : <Text type="supporting" color="secondary">No forecast level within range — {openSpace}.</Text>}
    </VStack>
  );
}

// ── structure at entry (code, never Mira) ────────────────────────────────────
function FvgAtEntry({ ict }) {
  const ctx = ict && ict.entry_context;
  if (!ctx) return null;
  const fvgs = ctx.fvgs_at_entry || {};
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary" weight="semibold">
        Structure at entry — gaps within ±{ctx.tol_pct}% of the {ctx.entry_price} fill · code, never Mira
      </Text>
      <HStack gap={3} wrap="wrap" align="baseline">
        {["1m", "5m", "15m"].map((tf) => {
          const rows = fvgs[tf] || [];
          return (
            <VStack key={tf} gap={0}>
              <Text type="supporting" color="secondary">{tf} gaps ({rows.length})</Text>
              {rows.map((g, i) => (
                <Text key={i} type="supporting">
                  <Badge variant={g.side === "bull" ? "success" : "error"} label={g.side} />
                  {" "}{g.lo}–{g.hi} · {g.formed_at}{g.inside ? " · entry inside" : ` · ${g.dist_pt}pt away`}
                </Text>
              ))}
            </VStack>
          );
        })}
        <VStack gap={0}>
          <Text type="supporting" color="secondary">HTF sweeps</Text>
          {(ctx.htf_sweeps || []).length
            ? ctx.htf_sweeps.map((s, i) => (
                <Text key={i} type="supporting">
                  <Badge variant={s.side === "SSL" ? "success" : "error"} label={s.side} />
                  {" "}{s.level} · {s.hours_before_entry}h before entry
                </Text>))
            : <Text type="supporting" color="secondary">none in the last 12 hourly bars</Text>}
        </VStack>
      </HStack>
    </VStack>
  );
}

// ── Analyze this trade ───────────────────────────────────────────────────────
function AnalyzeTrade({ day, tradeIndex, underlying, why, entryTag, exitTag, structTag }) {
  const [state, setState] = useState(null);
  const abortRef = useRef(null);
  const busy = state === "loading" || state === "streaming";

  const run = async () => {
    setState("loading");
    const res = await J.getTradeDna(day, tradeIndex, underlying);
    if (!res || !res.available || !res.dna) {
      setState({ error: (res && res.note) || "couldn't build the trade DNA" });
      return;
    }
    const prompt = buildAnalystPrompt(res.dna, { why, entryTag, exitTag, structTag }, res.playbook_session);
    setState("streaming");
    const { text, error } = await collectTurn(prompt, `trade-${day}-${tradeIndex}`, {
      onToken: (t) => setState({ text: t }),
      setAbort: (fn) => { abortRef.current = fn; },
    });
    if (error && !text) { setState({ error }); return; }
    if (text.trim() && res.trade_key) {
      J.saveTradeAnalysis({ day, trade_key: res.trade_key, underlying,
        label: res.dna.label, dna: res.dna, analysis: text });
    }
    setState({ text, dna: res.dna, saved: !!text.trim() });
  };

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await J.getTradeDna(day, tradeIndex, underlying);
      if (live && res && res.stored) {
        setState({ text: res.stored.analysis || "",
          dna: (res.stored.dna && res.stored.dna.label) ? res.stored.dna : res.dna,
          saved: true, analyzedAt: res.stored.analyzed_at });
      }
    })();
    return () => { live = false; if (abortRef.current) abortRef.current(); };
  }, [day, tradeIndex, underlying]);

  const has = typeof state === "object" && state && state.text != null;
  return (
    <VStack gap={2}>
      <HStack gap={2} align="center" justify="between">
        <Text type="label" color="secondary">The DNA — Mira&apos;s read</Text>
        <Button label={busy ? "Analyzing…" : has ? "↻ Re-analyze" : "🧬 Analyze this trade"}
          variant="secondary" isDisabled={busy} onClick={run} />
      </HStack>
      {busy && <HStack gap={2} align="center"><Spinner size="sm" />
        <Text type="supporting" color="secondary">
          {state === "loading" ? "Building the DNA (price action · volume · technicals · levels)…" : "Mira is writing the desk review…"}
        </Text></HStack>}
      {has && state.dna && state.dna.ict && <FvgAtEntry ict={state.dna.ict} />}
      {has && <MiraView text={state.text} />}
      {has && state.analyzedAt && (
        <Text type="supporting" color="secondary">saved {String(state.analyzedAt).slice(0, 16).replace("T", " ")}</Text>
      )}
      {typeof state === "object" && state && state.error && <Banner status="error" title={state.error} />}
    </VStack>
  );
}

// ── one trade ────────────────────────────────────────────────────────────────
function TradeCard({ t, tradeIndex, day, expanded, onToggle, thought, onThought, allLevels }) {
  const corr = t.correlation, nearest = corr && corr.nearest;
  const exitCorr = t.exit_correlation, exitNearest = exitCorr && exitCorr.nearest;
  const long = String(t.strategy).includes("call");
  const m = thought.match(THOUGHT_RE) || [];
  const op = operatorFor(t, thought);
  const rawTag = m[1] || null, rawExit = m[2] || null, rawStruct = m[3] || null;
  const setTag = (level) => onThought(encodeThought(level, rawExit, rawStruct, op.why));
  const setExitTag = (level) => onThought(encodeThought(rawTag, level, rawStruct, op.why));
  const setStructTag = (s) => onThought(encodeThought(rawTag, rawExit, s, op.why));
  const setWhy = (w) => onThought(encodeThought(rawTag, rawExit, rawStruct, w));

  // entry structure options (FVGs + sweeps), fetched on expand
  const [structCtx, setStructCtx] = useState(null);
  const [structLoading, setStructLoading] = useState(false);
  useEffect(() => {
    if (!expanded || structCtx) return;
    let live = true;
    setStructLoading(true);
    J.getEntryStructure(day, tradeIndex, t.ticker || "SPX")
      .then((r) => { if (live) setStructCtx((r && r.available && r.entry_context) || null); })
      .catch(() => {})
      .finally(() => { if (live) setStructLoading(false); });
    return () => { live = false; };
  }, [expanded]);

  const [sv, sl] = STATUS_BADGE[t.status] || ["neutral", t.status];
  return (
    <Section>
      <VStack gap={0} padding={2}>
        <HStack gap={2} align="center" wrap="wrap" className="vg-click" onClick={onToggle}>
          <Text type="body" weight="semibold" color={long ? "success" : "error"}>{t.label}</Text>
          {t.account_label && <Badge variant="neutral" label={t.account_label} />}
          <Text type="supporting" color="secondary">{t.ticker || "SPX"} {fmtLvl(t.spot_at_entry)}</Text>
          {nearest && <Badge variant={corr.at_level ? "success" : "neutral"}
            label={`${corr.at_level ? "✓ " : ""}${fmtLvl(nearest.level)}`} />}
          {exitNearest && <Text type="supporting" color="secondary">→</Text>}
          {exitNearest && <Badge variant={exitCorr.at_level ? "success" : "neutral"}
            label={`${exitCorr.at_level ? "✓ " : ""}${fmtLvl(exitNearest.level)}`} />}
          {t.status === "open"
            ? <Text type="supporting" color="secondary">open</Text>
            : <Text type="body" weight="semibold" color={t.realized >= 0 ? "success" : "error"}>{money(t.realized)}</Text>}
          <Badge variant={sv} label={sl} />
          <Text type="supporting" color="secondary">{expanded ? "▾" : "▸"}</Text>
        </HStack>
        {expanded && (
          <VStack gap={3} style={{ paddingTop: 10 }}>
            <div className="vg-cols wide">
              <VStack gap={1}>
                <Text type="supporting" color="secondary" weight="semibold">The order</Text>
                <Text type="supporting">strategy {t.strategy}</Text>
                {(t.legs || []).map((l, i) => (
                  <Text key={i} type="supporting">{l.side} {l.qty} × {(l.symbol || "").replace(/^\S+\s\S+\s/, "")} @ {l.price}</Text>
                ))}
                <Text type="supporting">opened {t.opened_et ? `${t.opened_et} ET` : "—"}{t.closed_et ? ` · closed ${t.closed_et} ET` : ""}</Text>
                <Text type="supporting">cost {money(t.cost)}{t.proceeds ? ` · proceeds ${money(t.proceeds)}` : ""}</Text>
                {t.settlement != null && <Text type="supporting">settlement {money(t.settlement)} @ SPX {fmtLvl(t.settle_price)}</Text>}
                {t.scale && (t.fills || []).length > 2 && (
                  <VStack gap={0}>
                    <Text type="supporting" color="secondary" weight="semibold">The ladder — {t.scale.peak_contracts}× peak</Text>
                    <Text type="supporting">{t.scale.entries} entries @ avg ${t.scale.avg_entry} → {t.scale.exits} exits @ avg ${t.scale.avg_exit}
                      {t.scale.add_behavior ? ` · ${t.scale.add_behavior}` : ""}{t.scale.exit_style ? ` · ${t.scale.exit_style}` : ""}</Text>
                    {(t.fills || []).map((r, i) => (
                      <Text key={i} type="supporting" color="secondary">
                        {r.at_et || (r.at || "").slice(11, 16)} {r.side} {r.qty}× @ ${Number(r.price).toFixed(2)} → {r.running} held
                      </Text>
                    ))}
                  </VStack>
                )}
              </VStack>
              <VStack gap={2}>
                <Text type="supporting">
                  in <b>{fmtLvl(t.spot_at_entry)}</b> → out <b>{fmtLvl(t.spot_at_exit)}</b>
                  {t.spot_at_entry != null && t.spot_at_exit != null &&
                    ` · ${(t.spot_at_exit - t.spot_at_entry) >= 0 ? "+" : ""}${(t.spot_at_exit - t.spot_at_entry).toFixed(1)}pt`}
                </Text>
                <CorrList title={`Entry · ${t.ticker || "SPX"} ${fmtLvl(t.spot_at_entry)}`} corr={corr} openSpace="entry was in open space" />
                <CorrList title={`Exit · ${t.ticker || "SPX"} ${fmtLvl(t.spot_at_exit)}`} corr={exitCorr} openSpace="exit was in open space" />
                <div className="vg-cols">
                  <VStack gap={0}>
                    <Text type="supporting" color="secondary">Level I entered on{op.entryTagAuto ? " · auto" : ""}</Text>
                    <select style={inputStyle} value={op.entryTag || ""} onChange={(e) => setTag(e.target.value || null)}
                      aria-label="Entry level tag">
                      <option value="">— none / open space —</option>
                      {allLevels.map((l, i) => (
                        <option key={i} value={l.price}>{fmtLvl(l.price)} · {l.role}{(l.kinds || []).length ? ` (${l.kinds.join(" + ")})` : ""}</option>
                      ))}
                    </select>
                  </VStack>
                  <VStack gap={0}>
                    <Text type="supporting" color="secondary">Level I exited on{op.exitTagAuto ? " · auto" : ""}</Text>
                    <select style={inputStyle} value={op.exitTag || ""} onChange={(e) => setExitTag(e.target.value || null)}
                      aria-label="Exit level tag">
                      <option value="">— none / open space —</option>
                      {allLevels.map((l, i) => (
                        <option key={i} value={l.price}>{fmtLvl(l.price)} · {l.role}{(l.kinds || []).length ? ` (${l.kinds.join(" + ")})` : ""}</option>
                      ))}
                    </select>
                  </VStack>
                  <VStack gap={0}>
                    <Text type="supporting" color="secondary">Structure I traded off · FVG / sweep</Text>
                    <select style={inputStyle} value={op.structTag || ""} onChange={(e) => setStructTag(e.target.value || null)}
                      disabled={!structCtx && !op.structTag} aria-label="Structure tag">
                      <option value="">{structLoading ? "reading structure…" : "— none —"}</option>
                      {op.structTag && structCtx == null && <option value={op.structTag}>{op.structTag}</option>}
                      {structCtx && ["1m", "5m", "15m"].map((tf) => {
                        const rows = (structCtx.fvgs_at_entry || {})[tf] || [];
                        return rows.length ? (
                          <optgroup key={tf} label={`${tf} gaps`}>
                            {rows.map((g, i) => {
                              const v = `${tf} ${g.side} FVG ${g.lo}-${g.hi}`;
                              return <option key={i} value={v}>
                                {g.side} {g.lo}–{g.hi}{g.inside ? " · entry inside" : ` · ${g.dist_pt}pt away`}
                              </option>;
                            })}
                          </optgroup>
                        ) : null;
                      })}
                      {structCtx && (structCtx.htf_sweeps || []).length > 0 && (
                        <optgroup label="HTF liquidity sweeps">
                          {structCtx.htf_sweeps.map((s, i) => {
                            const v = `hourly ${s.side} sweep at ${s.level} (${s.hours_before_entry}h before entry)`;
                            return <option key={i} value={v}>{s.side} {s.level} · {s.hours_before_entry}h before entry</option>;
                          })}
                        </optgroup>
                      )}
                    </select>
                  </VStack>
                </div>
              </VStack>
            </div>
            <VStack gap={0}>
              <Text type="supporting" color="secondary">My thinking — why did I take this trade?</Text>
              <textarea rows={2} style={inputStyle} value={op.why} onChange={(e) => setWhy(e.target.value)}
                placeholder="the read, the trigger, what I was expecting — the WHY the broker can't record" />
            </VStack>
            <AnalyzeTrade day={day} tradeIndex={tradeIndex} underlying={t.ticker || "SPX"}
              why={op.why} entryTag={op.entryTag} exitTag={op.exitTag} structTag={op.structTag} />
          </VStack>
        )}
      </VStack>
    </Section>
  );
}

// ── the day's trades panel ───────────────────────────────────────────────────
function TradesPanel({ snap, thoughts, onThought, notesDirty, onSaveNotes, saving }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const [batch, setBatch] = useState(null);
  const [tk, setTk] = useState("all");
  const [daySyn, setDaySyn] = useState(null);
  const [synHist, setSynHist] = useState([]);
  const [synPick, setSynPick] = useState(null);
  const day = String(snap.created_at || "").slice(0, 10);

  const load = async () => {
    setBusy(true);
    const v = await J.getSessionActivity(day, undefined);
    setBusy(false);
    setData(v && v.available ? v : { empty: true });
  };
  const loadDayReviews = async () => {
    try {
      const r = await J.getDayReviews(day);
      setSynHist((r && r.available && r.reviews) || []);
    } catch (e) { /* history is a nicety */ }
  };
  useEffect(() => {
    setData(null); setOpen(null); setTk("all"); setSynPick(null); setDaySyn(null);
    let live = true;
    (async () => {
      setBusy(true);
      const v = await J.getSessionActivity(day, undefined);
      if (live) { setData(v && v.available ? v : { empty: true }); setBusy(false); }
    })();
    loadDayReviews();
    return () => { live = false; };
  }, [snap.id, day]);

  const synthesizeDay = async () => {
    setDaySyn({ loading: true, text: "" });
    try {
      const res = await J.getDayReviewBundle(day, "SPX");
      if (!res || !res.available || !res.prompt) {
        setDaySyn({ error: (res && res.note) || "no completed trades to synthesize" });
        return;
      }
      const { text, data: sdata, error } = await collectTurn(res.prompt, `day-${day}`, {
        onToken: (t) => setDaySyn({ loading: true, text: t }),
      });
      if (error && !text) { setDaySyn({ error }); return; }
      setDaySyn({ text, data: sdata });
      if (text.trim()) {
        const b = res.bundle || {};
        J.saveDayReview({ day, underlying: "SPX", narrative: text,
          metrics: { net_pnl: b.net_pnl, counts: b.counts, metrics: b.metrics } })
          .then(() => loadDayReviews()).catch(() => {});
      }
    } catch (e) { setDaySyn({ error: String((e && e.message) || e) }); }
  };

  const analyzeToday = async () => {
    const trades = (data && data.trades) || [];
    const completed = trades.map((t, i) => ({ t, i })).filter(({ t }) => t.status !== "open");
    if (!completed.length) return;
    let analyzed = new Set();
    try {
      const ak = await J.getAnalyzedKeys(day);
      if (ak && ak.available) analyzed = new Set(ak.keys || []);
    } catch (e) { /* analyze all */ }
    const targets = completed.filter(({ t, i }) => !analyzed.has(`${t.opened_at || i}|${t.label}`));
    if (!targets.length) { await synthesizeDay(); return; }
    setBatch({ done: 0, total: targets.length, running: true });
    let done = 0;
    for (const { t, i } of targets) {
      const key = `${t.account || ""}|${t.opened_at || i}|${t.label}`;
      const operator = operatorFor(t, (thoughts && thoughts[key]) || "");
      try { await analyzeTradeOnce(day, i, t.ticker || "SPX", operator); } catch (e) { /* continue */ }
      done += 1;
      setBatch({ done, total: targets.length, running: done < targets.length });
    }
    setBatch({ done, total: targets.length, running: false });
    await load();
    await synthesizeDay();
  };

  if (!data) return <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Loading your trades…</Text></HStack>;
  if (data.empty) return <Text type="supporting" color="secondary">No trades on {day}.</Text>;

  const s = data.summary || {};
  const tickers = data.tickers || [];
  const rows = (data.trades || []).map((t, i) => ({ t, i })).filter(({ t }) => tk === "all" || t.ticker === tk);
  const allLevels = [
    ...(data.forecast_levels || []).map((z) => ({ ...z, source: "confluence" })),
    ...(data.gex_anchors || []).map((a) => ({ price: a.price, role: a.label, kinds: [a.label], source: "gex" })),
    ...(data.durable_levels || []).map((d) => ({ price: d.price, role: d.label, kinds: [d.label], source: "durable" })),
  ].sort((a, b) => (b.price || 0) - (a.price || 0));
  const liveSyn = daySyn && (daySyn.loading || daySyn.data || daySyn.text || daySyn.error);
  const storedSyn = !liveSyn && (synPick || synHist[0]);

  return (
    <VStack gap={2}>
      <HStack gap={2} align="center" justify="between" wrap="wrap">
        <Text type="label">My trades — {rows.length}{tk !== "all" ? ` of ${s.trades}` : ""} decisions</Text>
        <HStack gap={1} align="center">
          {tickers.length > 1 && (
            <select style={{ ...inputStyle, width: "auto" }} value={tk} onChange={(e) => setTk(e.target.value)}
              aria-label="Filter by ticker">
              <option value="all">All tickers</option>
              {tickers.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          {notesDirty && (
            <Button variant="primary" label={saving ? "Saving…" : "Save notes ●"} isDisabled={!!saving}
              onClick={onSaveNotes} />
          )}
          <Button variant="primary" isDisabled={busy || (batch && batch.running) || (daySyn && daySyn.loading)}
            onClick={analyzeToday}
            label={batch && batch.running ? `Analyzing ${batch.done}/${batch.total}…`
              : daySyn && daySyn.loading ? "Day synthesis…" : "Analyze today"} />
          <Button variant="secondary" label="⟳" isDisabled={busy} onClick={load} />
        </HStack>
      </HStack>

      {(liveSyn || storedSyn) && (
        <Section>
          <VStack gap={2} padding={2}>
            <HStack gap={2} align="center" justify="between" wrap="wrap">
              <Text type="label" color="secondary">Day synthesis — the book, not the trades</Text>
              {storedSyn && synHist.length > 1 && (
                <select style={{ ...inputStyle, width: "auto" }} value={(synPick || synHist[0]).id}
                  onChange={(e) => setSynPick(synHist.find((h) => String(h.id) === e.target.value) || null)}
                  aria-label="Pick a stored synthesis">
                  {synHist.map((h, i) => (
                    <option key={h.id} value={h.id}>
                      {String(h.generated_at || "").slice(11, 16)}{i === 0 ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </HStack>
            {liveSyn
              ? (daySyn.error ? <Banner status="warning" title={daySyn.error} />
                : (daySyn.data || daySyn.text)
                  ? <MiraView data={daySyn.data} text={daySyn.text} />
                  : <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Reading the day…</Text></HStack>)
              : <MiraView data={parseMira(storedSyn.narrative)} text={storedSyn.narrative} />}
          </VStack>
        </Section>
      )}

      <HStack gap={3} wrap="wrap">
        <HStack gap={1} align="baseline">
          <Text type="supporting">P&amp;L</Text>
          <Text type="supporting" weight="semibold" color={s.realized >= 0 ? "success" : "error"}>{money(s.realized)}</Text>
        </HStack>
        <Text type="supporting" color="secondary">fills {money(s.realized_from_fills)}</Text>
        {s.expired > 0 && <Text type="supporting" color="secondary">expiry {money(s.realized_from_expiry)} · {s.expired_worthless} worthless {money(s.expired_loss)}</Text>}
        <Text type="supporting" color="secondary">{s.winners}W / {s.losers}L{s.win_rate != null ? ` · win rate ${Math.round(s.win_rate * 100)}%` : ""}</Text>
        {s.profit_factor != null && <Text type="supporting" color="secondary">PF {s.profit_factor.toFixed(2)}</Text>}
        {s.level_discipline != null && <Text type="supporting" color="secondary">entered at level {Math.round(s.level_discipline * 100)}%</Text>}
        {s.exit_discipline != null && <Text type="supporting" color="secondary">exited at level {Math.round(s.exit_discipline * 100)}%</Text>}
      </HStack>

      <VStack gap={1}>
        {rows.map(({ t, i }) => {
          const key = `${t.account || ""}|${t.opened_at || i}|${t.label}`;
          return (
            <TradeCard key={key} t={t} tradeIndex={i} day={day}
              expanded={open === key} onToggle={() => setOpen(open === key ? null : key)}
              thought={(thoughts && thoughts[key]) || ""} onThought={(v) => onThought(key, v)}
              allLevels={allLevels} />
          );
        })}
      </VStack>
      <Text type="supporting" color="secondary">
        Price is the 1-minute print at submission, per the trade&apos;s own ticker. Tag the level and structure
        you were trading — the broker says WHAT you did; only you can say WHY. Saves with the entry.
      </Text>
    </VStack>
  );
}

// ── one day ──────────────────────────────────────────────────────────────────
function DayDetail({ s, onDelete, onSaveEntry, onAttach, saving }) {
  const [entry, setEntry] = useState(s.entry || {});
  const [confirmDel, setConfirmDel] = useState(false);
  const [thoughts, setThoughts] = useState(() => {
    try { return JSON.parse((s.entry || {}).trades || "{}"); } catch (e) { return {}; }
  });
  useEffect(() => {
    setEntry(s.entry || {});
    try { setThoughts(JSON.parse((s.entry || {}).trades || "{}")); } catch (e) { setThoughts({}); }
  }, [s.id]);
  const set = (k, v) => setEntry((e) => ({ ...e, [k]: v }));
  const setThought = (key, v) => setThoughts((t) => ({ ...t, [key]: v }));
  const save = async () => {
    const clean = {};
    for (const [k] of ENTRY_FIELDS) { const v = (entry[k] || "").trim(); if (v) clean[k] = v; }
    const kept = Object.fromEntries(Object.entries(thoughts).filter(([, v]) => (v || "").trim()));
    if (Object.keys(kept).length) clean.trades = JSON.stringify(kept);
    await onSaveEntry(s.id, clean);
  };
  // unsaved trade notes must be VISIBLE where they were edited, not only at
  // the form at the bottom — silent loss on navigation is the failure mode
  const notesDirty = useMemo(() => {
    const kept = Object.fromEntries(Object.entries(thoughts).filter(([, v]) => (v || "").trim()));
    let persisted = {};
    try { persisted = JSON.parse((s.entry || {}).trades || "{}"); } catch (e) { /* empty */ }
    return JSON.stringify(kept) !== JSON.stringify(persisted);
  }, [thoughts, s.entry]);

  const sc = s.scorecard;
  const f = s.forecast || {};
  const dayLabel = dayOf(s);
  const kindLabel = s.forecast_kind === "live" ? "today's live forecast" : "last night's forecast";
  return (
    <VStack gap={3}>
      <HStack gap={2} align="baseline" justify="between" wrap="wrap">
        <VStack gap={0}>
          <Text type="body" weight="semibold">{dayLabel === todayISO() ? "Today" : dayLabel}</Text>
          <Text type="supporting" color="secondary">
            {s.session ? `${s.session} playbook · ` : ""}vs. {kindLabel}
            {sc && sc.regime ? ` · ${sc.regime.correct ? "forecast held ✓" : "forecast missed ✗"}` : ""}
          </Text>
        </VStack>
        {confirmDel
          ? <HStack gap={1} align="center">
              <Text type="supporting" color="error">delete this day&apos;s entry?</Text>
              <Button variant="primary" label="yes, delete" onClick={() => onDelete(s.id)} />
              <Button variant="secondary" label="keep" onClick={() => setConfirmDel(false)} />
            </HStack>
          : <Button variant="secondary" label="delete" onClick={() => setConfirmDel(true)} />}
      </HStack>

      <TradesPanel snap={s} thoughts={thoughts} onThought={setThought}
        notesDirty={notesDirty} onSaveNotes={save} saving={saving} />

      <Section>
        <VStack gap={2} padding={2}>
          <Text type="label" color="secondary">
            Forecast vs. actual{sc && sc.level_accuracy != null ? ` · levels ${pct(sc.level_accuracy)}` : ""}
            {sc && sc.regime ? ` · ${sc.regime.outcome} (${sc.regime.moved_pct}%)` : ""}
          </Text>
          <div className="vg-cols">
            <VStack gap={0}>
              <Text type="supporting" color="secondary">The forecast</Text>
              <Text type="supporting">{f.plan ? `${f.gamma} gamma — ${f.plan}` : "No forecast frozen"}</Text>
              {f.spot != null && <Text type="supporting" color="secondary">spot at forecast {Math.round(f.spot)}{f.gamma_flip != null ? ` · flip ${Math.round(f.gamma_flip)}` : ""}</Text>}
            </VStack>
            <VStack gap={0}>
              <Text type="supporting" color="secondary">Actual</Text>
              {sc ? <Text type="supporting">price {sc.price_low}–{sc.price_high} (last {sc.price_last})
                {sc.level_accuracy != null ? ` · levels ${pct(sc.level_accuracy)}` : ""}</Text>
                : <Text type="supporting" color="secondary">Not scored yet.</Text>}
            </VStack>
          </div>
          {(s.images || []).length > 0 && (
            <HStack gap={2} wrap="wrap">
              {(s.images || []).map((img, i) => (
                <a key={i} href={J.journalImageUrl(img.id || img)} target="_blank" rel="noreferrer">
                  <img src={J.journalImageUrl(img.id || img)} alt="reference chart"
                    style={{ maxHeight: 120, borderRadius: 6, border: "1px solid var(--color-border)" }} />
                </a>
              ))}
            </HStack>
          )}
          <HStack gap={2} align="center">
            <Text type="supporting" color="secondary">Attach a reference chart (never analyzed):</Text>
            <input type="file" accept="image/*" aria-label="Attach a chart"
              onChange={(e) => e.target.files && e.target.files[0] && onAttach(e.target.files[0])} />
          </HStack>
        </VStack>
      </Section>

      <Section>
        <VStack gap={2} padding={2}>
          <Text type="label" color="secondary">My journal — the day overall</Text>
          <div className="vg-cols">
            {ENTRY_FIELDS.map(([k, label, ph]) => (
              <VStack key={k} gap={0}>
                <Text type="supporting" color="secondary">{label}</Text>
                {k === "notes"
                  ? <textarea rows={2} style={inputStyle} placeholder={ph} value={entry[k] || ""}
                      onChange={(e) => set(k, e.target.value)} />
                  : <input style={inputStyle} placeholder={ph} value={entry[k] || ""}
                      onChange={(e) => set(k, e.target.value)} />}
              </VStack>
            ))}
          </div>
          <HStack gap={2}>
            <Button variant="primary" label={saving ? "Saving…" : "Save entry + trade notes"}
              isDisabled={!!saving} onClick={save} />
          </HStack>
        </VStack>
      </Section>
    </VStack>
  );
}

// ── Analysis tab ─────────────────────────────────────────────────────────────
const RUBRIC_LABELS = {
  entry_discipline: "Entry discipline", exit_discipline: "Exit discipline",
  risk_sizing: "Risk & sizing", plan_adherence: "Plan adherence",
  emotional_control: "Emotional control",
};

function AnalysisDetail({ h }) {
  const recs = (h.recommendations && h.recommendations.length)
    ? h.recommendations
    : Object.entries(h.scores || {}).map(([dim, score]) => ({
        dimension: dim, label: RUBRIC_LABELS[dim] || dim, score, status: "new", delta: null }));
  return (
    <VStack gap={2}>
      {recs.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {recs.map((r, i) => (
            <Badge key={i} variant={r.score >= 70 ? "success" : r.score >= 45 ? "warning" : "error"}
              label={`${r.label || RUBRIC_LABELS[r.dimension] || r.dimension} ${r.score}${r.delta != null ? ` (${r.delta >= 0 ? "+" : ""}${r.delta})` : ""}`} />
          ))}
        </HStack>
      )}
      {(h.patterns || []).length > 0 && (
        <VStack gap={0}>
          <Text type="supporting" color="secondary" weight="semibold">Patterns</Text>
          {(h.patterns || []).map((p, i) => (
            <Text key={i} type="supporting">{p.count}× {p.pattern}<Text type="supporting" color="secondary"> · {(p.cites || []).length} trades</Text></Text>
          ))}
        </VStack>
      )}
      {h.swot
        ? <SwotView swot={h.swot} />
        : <MiraView data={parseMira(h.narrative)} text={h.narrative || "(no narrative saved)"} />}
    </VStack>
  );
}

function AnalysisPanel({ sym }) {
  const week = () => {
    const to = todayISO();
    const d = new Date(); d.setDate(d.getDate() - 6);
    const from = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
    return { from, to };
  };
  const [win, setWin] = useState({ ...week(), period: "weekly" });
  const [read, setRead] = useState(null);
  const [hist, setHist] = useState(null);
  const [openId, setOpenId] = useState(null);
  const abortRef = useRef(null);

  const loadHist = async () => {
    const h = await J.getJournalAnalyses(sym);
    const list = h && h.available ? (h.analyses || []) : [];
    setHist(list);
    return list;
  };
  useEffect(() => { setRead(null); setOpenId(null); loadHist(); }, [sym]);

  const generate = async () => {
    setRead({ loading: true });
    const res = await J.getJournalAnalysisBundle(win.from, win.to, sym);
    if (!res || !res.available || !res.bundle) {
      setRead({ error: (res && res.note) || "couldn't build the bundle" }); return;
    }
    setRead({ text: "" });
    const { text, data, error } = await collectTurn(res.prompt, `journal-${win.from}-${win.to}`, {
      onToken: (t) => setRead({ text: t }),
      setAbort: (fn) => { abortRef.current = fn; },
    });
    if (error && !text) { setRead({ error }); return; }
    setRead({ text, data });
    if (text.trim()) {
      const b = res.bundle;
      const swotSec = data && Array.isArray(data.sections)
        ? data.sections.find((x) => x && x.kind === "swot") : null;
      J.saveJournalAnalysis({
        period: win.period, window_from: win.from, window_to: win.to,
        underlying: sym, rubric_version: b.rubric_version,
        trades: b.trades, net_pnl: b.net_pnl, scores: b.scores,
        patterns: b.patterns, recommendations: b.recommendations,
        swot: (swotSec && swotSec.swot) || null, narrative: text,
      }).then((r) => {
        loadHist().then(() => { setRead(null); if (r && r.id) setOpenId(r.id); });
      }).catch((e) => {
        setRead((cur) => ({ ...(cur || {}), text,
          error: `analysis rendered but SAVE FAILED: ${String((e && e.message) || e)}` }));
      });
    }
  };
  useEffect(() => () => { if (abortRef.current) abortRef.current(); }, []);

  const busy = read && read.loading;
  return (
    <VStack gap={3}>
      <Section>
        <VStack gap={2} padding={2}>
          <HStack gap={2} align="end" wrap="wrap">
            <VStack gap={0}><Text type="supporting" color="secondary">From</Text>
              <input type="date" style={inputStyle} value={win.from}
                onChange={(e) => setWin((w) => ({ ...w, from: e.target.value }))} aria-label="Window from" /></VStack>
            <VStack gap={0}><Text type="supporting" color="secondary">To</Text>
              <input type="date" style={inputStyle} value={win.to}
                onChange={(e) => setWin((w) => ({ ...w, to: e.target.value }))} aria-label="Window to" /></VStack>
            <VStack gap={0}><Text type="supporting" color="secondary">Tag as</Text>
              <select style={inputStyle} value={win.period}
                onChange={(e) => setWin((w) => ({ ...w, period: e.target.value }))} aria-label="Period tag">
                <option value="daily">daily</option><option value="weekly">weekly</option>
                <option value="monthly">monthly</option><option value="on-demand">on-demand</option>
              </select></VStack>
            <Button variant="primary" label={busy ? "Generating…" : "Generate analysis"}
              isDisabled={!!busy} onClick={generate} />
          </HStack>
          <Text type="supporting" color="secondary">
            Scores + pattern census + citations, built on the stored per-trade reviews — and it reads
            the PRIOR analysis so self-knowledge compounds. Analyze trades first (Days → Analyze today).
          </Text>
          {read && read.error && <Banner status="warning" title={read.error} />}
          {read && read.text != null && !read.error && (
            read.text ? <MiraView data={read.data} text={read.text} />
              : <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Reading the window…</Text></HStack>
          )}
        </VStack>
      </Section>
      {(hist || []).map((h) => (
        <Section key={h.id}>
          <VStack gap={1} padding={2}>
            <HStack gap={2} align="center" wrap="wrap" className="vg-click"
              onClick={() => setOpenId(openId === h.id ? null : h.id)}>
              <Badge variant="neutral" label={h.period || "run"} />
              <Text type="body" weight="semibold">{h.window_from} → {h.window_to}</Text>
              <Text type="supporting" color="secondary">
                {h.trades != null ? `${h.trades} trades` : ""}{h.net_pnl != null ? ` · ${money(h.net_pnl)}` : ""}
                {h.generated_at ? ` · ${String(h.generated_at).slice(0, 16).replace("T", " ")}` : ""}
              </Text>
              <Text type="supporting" color="secondary">{openId === h.id ? "▾" : "▸"}</Text>
            </HStack>
            {openId === h.id && <AnalysisDetail h={h} />}
          </VStack>
        </Section>
      ))}
      {hist && !hist.length && <Text type="supporting" color="secondary">No stored analyses yet for {sym}.</Text>}
    </VStack>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────
export function JournalPage() {
  const [tab, setTab] = useState("days");
  const [sym, setSym] = useState("SPX");
  const [selDay, setSelDay] = useState(todayISO());
  const [nonce, setNonce] = useState(0);
  const [d, setD] = useState(null);
  const [saving, setSaving] = useState(false);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    let live = true;
    J.getJournal(sym).then((v) => { if (live) setD(v); }).catch(() => { if (live) setD({ available: false }); });
    return () => { live = false; };
  }, [sym, nonce]);
  const ensuredRef = useRef({});
  useEffect(() => {
    if (ensuredRef.current[sym]) return;
    ensuredRef.current[sym] = true;
    J.ensureTodayJournal(sym).then(reload).catch(() => {});
  }, [sym]);

  const snaps = (d && d.snapshots) || [];
  const byDay = useMemo(() => {
    const m = {};
    for (const s of snaps) { const k = dayOf(s); if (k && !m[k]) m[k] = s; }
    return m;
  }, [snaps]);
  const selSnap = byDay[selDay] || null;

  const doDelete = async (id) => { await J.deleteJournal(id); reload(); };
  const doSaveEntry = async (id, entry) => { setSaving(true); await J.saveJournalEntry(id, entry); setSaving(false); reload(); };
  const doAttach = async (f) => { if (!f || !selSnap) return; await J.uploadJournal(f, "", "prior", selSnap.id, sym); reload(); };

  return (
    <Ledger
      band={
        <VStack gap={2}>
          <HStack gap={3} align="center" justify="between" wrap="wrap">
            <VStack gap={0}>
              <Heading level={1}>Trading Journal</Heading>
              <Text type="supporting" color="secondary">
                the canonical record — decisions, reasoning, reviews ·{" "}
                <Link href="/#/journal">legacy journal →</Link>
              </Text>
            </VStack>
            <HStack gap={2} align="center" wrap="wrap">
              <select style={{ ...inputStyle, width: "auto" }} value={sym} onChange={(e) => setSym(e.target.value)}
                aria-label="Underlying">
                {["SPX", "QQQ", "IWM"].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <SegmentedControl value={tab} onChange={setTab} label="Journal view">
                <SegmentedControlItem value="days" label="Days" />
                <SegmentedControlItem value="analysis" label="Analysis" />
              </SegmentedControl>
            </HStack>
          </HStack>
          {tab === "days" && <DayStrip byDay={byDay} selDay={selDay} onSelect={setSelDay} />}
        </VStack>
      }>
      {d && d.available === false && <Banner status="error" title={d.note || "Journal needs the SQLite backend + a generated playbook."} />}
      {tab === "analysis"
        ? <AnalysisPanel sym={sym} />
        : selSnap
          ? <DayDetail key={selSnap.id} s={selSnap} saving={saving}
              onDelete={doDelete} onSaveEntry={doSaveEntry} onAttach={doAttach} />
          : <Text type="supporting" color="secondary">
              {selDay === todayISO()
                ? (d ? "Setting up today's entry — it freezes last night's forecast and scores it against today's SPX price…" : "loading…")
                : `No journal entry for ${selDay}.`}
            </Text>}
    </Ledger>
  );
}
