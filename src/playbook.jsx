// PlaybookView — the daily 0DTE SPX playbook (Intelligence nav).
// SPX is not a holding, so this is its own top-level view (not a ticker
// notebook). It shows: a pinned regime summary (gamma · flip · walls ·
// catalyst), the plain-English narrative (Mira's LLM polish of the templated
// scaffold), and collapsible structured sections (level ladder, conditional
// setups, lookback edges). Refreshed nightly by the Vantage batch; the view
// reads the latest. Context, not a signal (ADR-008) — no orders placed.
import { cls, SymbolSwitcher } from "./util.jsx";
import { Term, GlossaryCard } from "./glossary.jsx";
import { useLive, getPlaybook, getPlaybookPine, recomputePlaybook, getTicket, executeTicket, getOdteRead, getChart } from "./live.js";

const { useMemo, useState } = React;

const fmtP = (v) => (v == null ? "—" : (Math.abs(v - Math.round(v)) < 0.05
  ? String(Math.round(v)) : v.toFixed(1)));

// A level's kind → a coarse tone for the ladder chips.
function levelTone(kind) {
  const k = (kind || "").toLowerCase();
  if (k.includes("resistance") || k.includes("call wall")) return "bad";
  if (k.includes("support") || k.includes("put wall")) return "good";
  if (k.includes("flip") || k.includes("pin") || k.includes("pain")) return "warn";
  return "plain";
}

export function PlaybookView({ refreshNonce }) {
  // Local reload nonce so Recompute re-pulls without a full app refresh.
  const [nonce, setNonce] = useState(0);
  const [sym, setSym] = useState("SPX");     // SPX | QQQ | IWM
  const [pine, setPine] = useState(null);   // {loading|script|error} for the export modal
  const [busy, setBusy] = useState(false);  // recompute in flight
  const [ticket, setTicket] = useState(null); // {level, kind, role} → staging modal

  // After a recompute we must re-pull with refresh=true so Mira busts its cached
  // (stale) narrative + scaffold and picks up the freshly-recomputed GEX.
  const [didRecompute, setDidRecompute] = useState(false);
  const pb = useLive(() => getPlaybook(undefined, { refresh: didRecompute, symbol: sym }),
                     null, [refreshNonce, nonce, sym]);
  const p = pb.data;

  const exportPine = async () => {
    setPine({ loading: true });
    const res = await getPlaybookPine(undefined, sym);
    setPine(res && res.available ? { script: res.script } : { error: true });
  };
  const recompute = async () => {
    if (busy) return;
    setBusy(true);
    await recomputePlaybook(undefined, sym);  // writes the store (fresh GEX + durable)
    setBusy(false);
    setDidRecompute(true);      // next getPlaybook re-narrates off the fresh scaffold
    setNonce((n) => n + 1);     // re-pull the (now fresh) playbook + narrative
  };

  const reg = (p && p.regime) || {};
  const cat = (p && p.catalysts) || {};
  const spot = reg.spot;

  // The flip/walls for the pinned summary, pulled off the ladder by kind.
  const keyLevels = useMemo(() => {
    const out = { flip: null, call: null, put: null };
    for (const r of (p && p.levelLadder) || []) {
      const k = (r.kind || "").toLowerCase();
      if (k.includes("flip") && out.flip == null) out.flip = r.price;
      if (k.includes("call wall") && out.call == null) out.call = r.price;
      if (k.includes("put wall") && out.put == null) out.put = r.price;
    }
    return out;
  }, [p]);

  if (p && p.available === false) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>0DTE SPX Playbook</h2>
        <p className="vg-note">
          No playbook generated yet. Run <code>python -m vantage_server.spx_playbook</code>{" "}
          (nightly, after Sentinel's GEX/zone snapshot). It fuses dealer-gamma, S/R,
          breadth/VIX, Fed/macro, and SPX chart structure into a daily read.
        </p>
      </div>
    );
  }

  return (
    <div className="vg-pane-body vg-playbook">
      {/* ---- pinned summary ---- */}
      <div className="vg-pb-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>0DTE {sym} Playbook</h2>
          <div className="vg-row" style={{ gap: 10, marginTop: 6, marginBottom: 4, alignItems: "center" }}>
            <SymbolSwitcher value={sym} onChange={setSym} />
          </div>
          <div className="vg-note">
            {p ? `for ${p.session || "the next session"}` : "loading…"}
            {reg.gamma ? ` · gamma ${reg.gamma}` : ""}
            {reg.vix != null ? ` · VIX ${fmtP(reg.vix)}${reg.vix_band ? ` (${reg.vix_band})` : ""}` : ""}
          </div>
          <div className="vg-row" style={{ gap: 6, marginTop: 8 }}>
            <button className="vg-btn-sm" onClick={exportPine}>Export to Pine</button>
            <button className="vg-btn-sm vg-btn-primary" disabled={busy} onClick={recompute}
              title="Rebuild levels + GEX from the latest data and re-narrate the read at the current price">
              {busy ? "Refreshing…" : "⟳ Refresh plan"}</button>
          </div>
        </div>
        <div className="vg-pb-levels">
          {spot != null && <SummaryTile label="Spot" value={fmtP(spot)} />}
          <SummaryTile label="Flip" value={fmtP(keyLevels.flip)} tone="warn" />
          <SummaryTile label="Put wall" value={fmtP(keyLevels.put)} tone="good" />
          <SummaryTile label="Call wall" value={fmtP(keyLevels.call)} tone="bad" />
        </div>
      </div>

      {pine && <PineModal pine={pine} session={p && p.session} onClose={() => setPine(null)} />}
      {ticket && <TicketModal sym={sym} spot={spot} seed={ticket} onClose={() => setTicket(null)} />}

      {cat.today && (
        <div className="vg-pb-catalyst">
          ⚠️ Catalyst today: <b>{cat.today}</b> — expect bigger moves; size down.
        </div>
      )}

      {/* ---- RIGHT NOW: deterministic live-spot vs pivot banner (code, not
           narrative) — which setup's condition is met at this minute, and how
           stale the written plan is. ---- */}
      <NowBanner flip={keyLevels.flip} planSpot={spot} sym={sym} nonce={nonce} />

      {/* ---- the plain-English narrative ---- */}
      <div className="vg-card">
        <div className="vg-kicker">Today's read</div>
        {p && p.narrative
          ? <div className="vg-pb-narrative" style={{ whiteSpace: "pre-wrap" }}>{p.narrative}</div>
          : <p className="vg-note" style={{ margin: "6px 0 0" }}>
              {pb.loading ? "Generating the read…" : "No narrative available."}
            </p>}
        {p && p.structureNote && (
          <div className="vg-note" style={{ marginTop: 8, fontSize: 13 }}>
            <b>Structure:</b> {p.structureNote}
          </div>
        )}
        {p && p.volumeNote && (
          <div className="vg-note" style={{ marginTop: 2, fontSize: 13 }}>
            <b>Volume:</b> {p.volumeNote}
          </div>
        )}
      </div>

      {/* ---- 0DTE vol read: implied (recorded chain) vs realized → act / sit ---- */}
      <VolReadCard />

      {/* ---- market context: breadth · VIX term structure · sectors · intermarket ---- */}
      {p && (reg.breadth_pct_above_50ma != null || reg.vix != null || reg.intermarket) && (
        <MarketContextCard reg={reg} sectors={(p && p.sectors) || []} />
      )}

      {/* ---- plain-English explanation of today's regime + how to trade it ---- */}
      {p && reg.gamma && (
        <PlainEnglish reg={reg} keyLevels={keyLevels} />
      )}

      {/* ---- durable memory levels (respected across many sessions) ---- */}
      {p && p.durable && p.durable.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Durable levels ★ (memory)</div>
          <div className="vg-note" style={{ fontSize: 12, margin: "2px 0 8px" }}>
            Levels the tape kept respecting across many sessions — the "traces back weeks" levels.
          </div>
          <div className="vg-pb-ladder">
            {p.durable.map((z, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn")}
                  style={{ minWidth: 62, textAlign: "right" }}>
                  {fmtP(z.price)}
                </span>
                <span style={{ fontSize: 14 }}>{z.kind || `durable ${z.role}`}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {z.sessions}× sessions{z.respected ? ` · respected ${z.respected}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- confluence zones (≥2 dimensions stacking) ---- */}
      {p && p.confluence && p.confluence.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Confluence zones ✦</div>
          <div className="vg-note" style={{ fontSize: 12, margin: "2px 0 8px" }}>
            Bands where 2+ dimensions (GEX wall / fib / PoC / S-R) line up — the high-signal levels.
          </div>
          <div className="vg-pb-ladder">
            {p.confluence.map((z, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn")}
                  style={{ minWidth: 62, textAlign: "right" }}>
                  {fmtP(z.price)}
                </span>
                <span style={{ fontSize: 14 }}>{(z.kinds || []).slice(0, 3).join(" + ")}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>
                  {z.role}{z.strength ? ` · ${z.strength} dims` : ""}
                </span>
                <button className="vg-linkbtn" style={{ fontSize: 12 }}
                  onClick={() => setTicket({ level: z.price, kind: (z.kinds || []).join(" + "), role: z.role })}>
                  ticket
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- conditional setups ---- */}
      {p && p.setups && p.setups.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Conditional setups</div>
          <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
            {p.setups.map((su, i) => (
              <div key={i} className="vg-pb-setup">
                <div className="vg-pb-trigger">IF {su.trigger}</div>
                {su.bias && <div className="vg-note" style={{ marginBottom: 2 }}>{su.bias}</div>}
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{su.structure}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- level ladder (collapsible) ---- */}
      {p && p.levelLadder && p.levelLadder.length > 0 && (
        <details className="vg-card" open>
          <summary className="vg-kicker" style={{ cursor: "pointer" }}>
            Level ladder ({p.levelLadder.length})
          </summary>
          <div className="vg-pb-ladder">
            {p.levelLadder.map((r, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", levelTone(r.kind))} style={{ minWidth: 62, textAlign: "right" }}>
                  {fmtP(r.price)}
                </span>
                <span style={{ fontSize: 14 }}>{r.kind}</span>
                {r.source && <span className="vg-note" style={{ marginLeft: "auto", fontSize: 12 }}>{r.source}</span>}
                <button className="vg-linkbtn" style={{ fontSize: 12, marginLeft: r.source ? 0 : "auto" }}
                  onClick={() => setTicket({ level: r.price, kind: r.kind, role: levelTone(r.kind) === "good" ? "support" : levelTone(r.kind) === "bad" ? "resistance" : null })}>
                  ticket
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ---- lookback edges (collapsible) ---- */}
      {p && p.edges && (p.edges.gex_regime_next_day_range || p.edges.day_time) && (
        <details className="vg-card">
          <summary className="vg-kicker" style={{ cursor: "pointer" }}>Lookback edges</summary>
          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
            {p.edges.gex_regime_next_day_range && p.edges.gex_regime_next_day_range.read && (
              <div><b>Gamma → next-day range:</b> {p.edges.gex_regime_next_day_range.read}</div>
            )}
            {p.edges.day_time && p.edges.day_time.by_slot && (
              <div style={{ marginTop: 4 }}><b>By time of day (avg 15m range):</b>{" "}
                {Object.entries(p.edges.day_time.by_slot).map(([k, v]) => `${k} ${v}pt`).join(" · ")}
              </div>
            )}
            {p.edges.zone_hit_rate && (
              <div style={{ marginTop: 4 }}><b>Zone hit-rate (Sentinel):</b>{" "}
                {Math.round((p.edges.zone_hit_rate.hit_rate || 0) * 100)}% over{" "}
                {p.edges.zone_hit_rate.tested} tested ({p.edges.zone_hit_rate.avg_coverage_pct}% coverage)
              </div>
            )}
          </div>
        </details>
      )}

      {/* ---- glossary (plain definitions on demand) ---- */}
      <GlossaryCard terms={["positive_gamma", "negative_gamma", "mean_reversion",
        "fade", "gamma_flip", "call_wall", "put_wall", "max_pain", "confluence"]} />

      {/* ---- caveats footer ---- */}
      {p && p.caveats && p.caveats.length > 0 && (
        <div className="vg-pb-caveats">
          {p.caveats.map((c, i) => <div key={i}>{c}</div>)}
          {p.missing && p.missing.length > 0 && (
            <div>Thinner read — missing sources: {p.missing.join(", ")}.</div>
          )}
        </div>
      )}
    </div>
  );
}

// RIGHT NOW — deterministic: live 1m close vs the plan's pivot decides which
// conditional setup is currently ACTIVE, with the distance to flipping. Also
// flags plan staleness (live spot vs the spot the plan was written at) so the
// operator knows when to hit ⟳ Refresh. Pure arithmetic; no model.
function NowBanner({ flip, planSpot, sym, nonce }) {
  const q = useLive(() => getChart(sym === "SPX" ? "SPX" : sym, "1m", 2), null, [sym, nonce]);
  const candles = (q.data && q.data.available && q.data.candles) || [];
  const last = candles.length ? candles[candles.length - 1] : null;
  if (!last || flip == null) return null;
  const S = last.close;
  const t = String(last.time_et || last.time || "").slice(11, 16);
  const above = S >= flip;
  const dist = Math.abs(S - flip).toFixed(1);
  const drift = planSpot != null ? Math.abs(S - planSpot) : null;
  return (
    <div className="vg-card vg-pb-now">
      <div className="vg-row" style={{ gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className="vg-kicker" style={{ margin: 0 }}>Right now</span>
        <b style={{ fontFamily: "var(--vg-font-data)", fontVariantNumeric: "tabular-nums" }}>
          {sym} {S.toFixed(1)}{t ? ` (${t} bar)` : ""}</b>
        <span className={cls("vg-badge", above ? "good" : "bad")} style={{ fontWeight: 700 }}>
          {above ? "ABOVE" : "BELOW"} PIVOT {flip}
        </span>
        <span className="vg-note">
          setup {above ? "2 (range / sell rallies)" : "1 (trend / don't fight it)"} territory ·
          {" "}{dist}pt from flipping to setup {above ? "1" : "2"}
        </span>
        {drift != null && drift > 15 && (
          <span className="vg-badge warn" style={{ fontSize: "var(--vg-text-xs)" }}>
            plan written at {planSpot} — {drift.toFixed(0)}pt away · hit ⟳ Refresh
          </span>
        )}
      </div>
    </div>
  );
}

// "Today, in plain English" — turns the regime + key levels into a readable
// story with hoverable jargon, so a non-options reader knows what to actually do.
function PlainEnglish({ reg, keyLevels }) {
  const pos = reg.gamma === "positive";
  const spot = reg.spot;
  const { flip, call, put } = keyLevels;
  return (
    <div className="vg-card">
      <div className="vg-kicker">Today, in plain English</div>
      <div style={{ fontSize: 14, lineHeight: 1.6, marginTop: 6 }}>
        <p style={{ margin: "0 0 8px" }}>
          Dealers are in{" "}
          <b><Term k={pos ? "positive_gamma" : "negative_gamma"}>{pos ? "positive gamma" : "negative gamma"}</Term></b>{" "}
          today{reg.vix != null ? ` (VIX ${fmtP(reg.vix)})` : ""}. {pos ? (
            <>That means their hedging works like a shock absorber — selling rallies
            and buying dips — so this is a{" "}
            <b><Term k="mean_reversion">mean-reversion</Term></b> day: expect price to
            chop in a range rather than trend hard. The play is to{" "}
            <b><Term k="fade">fade</Term> the edges</b> — sell rallies into resistance,
            buy dips into support — instead of chasing breakouts.</>
          ) : (
            <>That means their hedging <i>amplifies</i> moves — selling into drops,
            buying into rallies — so moves can run. This is a momentum tape: trade{" "}
            <b>with</b> the move, not against it, and respect breakouts.</>
          )}
        </p>
        <p style={{ margin: 0 }}>
          {flip != null && spot != null && (
            <>Your line in the sand is the{" "}
            <b><Term k="gamma_flip">gamma flip</Term> at {fmtP(flip)}</b>: while price
            holds above it you're in the {pos ? "calm, range-bound" : "current"} regime;
            a break below flips it to the faster, trending mode. </>
          )}
          {call != null && (
            <>Rallies tend to stall at the{" "}
            <b><Term k="call_wall">call wall</Term> ({fmtP(call)})</b>
            {put != null ? <>, and dips get bought near the{" "}
            <b><Term k="put_wall">put wall</Term> ({fmtP(put)})</b></> : null}.</>
          )}
        </p>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div className="vg-pb-tile">
      <div className="vg-note" style={{ fontSize: 12 }}>{label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}

// 0DTE vol read — the odte_research Phase-A verdict: is today's movement
// overpriced (sell premium), underpriced (long vol), or fair (stand down)?
// Implied = ATM straddle from OUR recorded chain (chain_snaps, Alpaca; SPY is
// the SPX proxy — Alpaca carries no index options). Realized = 20-session
// median daily move. Deterministic; staleness shown honestly.
function VolReadCard() {
  const q = useLive(() => getOdteRead("SPY"), null, []);
  const d = q.data;
  if (!d) return null;                                  // loading — no flash
  if (!d.available) {
    return (
      <div className="vg-card">
        <div className="vg-kicker">0DTE vol read</div>
        <div className="vg-note" style={{ fontSize: 12 }}>{d.note}</div>
      </div>
    );
  }
  const tone = d.verdict === "SELL PREMIUM" ? "good"
    : d.verdict === "BUY / LONG VOL" ? "warn" : "plain";
  return (
    <div className="vg-card">
      <div className="vg-spread" style={{ alignItems: "baseline" }}>
        <div className="vg-kicker">0DTE vol read <span className="vg-note" style={{ fontWeight: 400 }}>
          — {d.underlying} (SPX proxy) · exp {d.expiry}</span></div>
        <span className={cls("vg-badge", tone)} style={{ fontSize: "var(--vg-text-sm)", fontWeight: 700 }}>
          {d.verdict}
        </span>
      </div>
      <div className="vg-row" style={{ gap: 20, margin: "8px 0 4px", flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
        <span className="vg-note">implied <b style={{ color: "var(--vg-ink)" }}>{d.implied_move_pct}%</b>
          {" "}(${d.straddle_usd} straddle @ {d.atm_strike})</span>
        <span className="vg-note">delivered (20d med) <b style={{ color: "var(--vg-ink)" }}>{d.realized_med_pct ?? "—"}%</b></span>
        {d.ratio != null && <span className="vg-note">ratio <b style={{ color: "var(--vg-ink)" }}>{d.ratio}×</b></span>}
        {d.atm_iv != null && <span className="vg-note">ATM IV {(d.atm_iv * 100).toFixed(1)}%</span>}
      </div>
      <div className="vg-note" style={{ fontSize: "var(--vg-text-sm)" }}>{d.verdict_note}</div>
      <div className="vg-note" style={{ fontSize: "var(--vg-text-xs)", marginTop: 6, opacity: d.degraded ? 1 : 0.7 }}>
        {d.degraded ? "⚠ STALE — " : ""}chain snapped {d.age_minutes != null ? `${d.age_minutes} min ago` : "—"} ·
        {" "}{d.source} · context, not a signal (ADR-008) · sitting out is a position
      </div>
    </div>
  );
}

// Market context — the native breadth / VIX-term-structure / sector / intermarket
// read (market_context.py). The two backtested edges (goal market-context-native)
// ride along as one-line "what this implies for tomorrow" notes.
function MarketContextCard({ reg, sectors }) {
  const pct = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`);
  const breadth = reg.breadth_pct_above_50ma;
  // edge (H4): low breadth <40% → wider next-day range + mean-reversion bounce.
  const breadthNote = breadth == null ? null
    : breadth < 40 ? "Narrow tape — backtests show a wider, mean-reversion-prone next day."
      : breadth > 60 ? "Broad participation — historically a calmer, tighter next day."
        : "Mixed breadth.";
  const stance = reg.vix_term_stance;
  // edge (H2): backwardation → ~2.3x wider next-day SPX range (mostly high-VIX).
  const termNote = !stance ? null
    : stance === "backwardation"
      ? "Front-month stress — backtests show a materially wider next-day range."
      : "Term structure calm (contango).";
  const im = reg.intermarket || {};
  const imRow = (label, o) => (o && typeof o === "object"
    ? <div key={label} className="vg-mc-im">
        <span className="vg-note" style={{ fontSize: 12 }}>{label}</span>
        <span style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{o.level}</span>
        <span className={cls("vg-badge", o.chg_pct >= 0 ? "good" : "bad")} style={{ fontSize: 12 }}>
          {pct(o.chg_pct)}
        </span>
      </div> : null);
  const lead = sectors && sectors[0];
  const lag = sectors && sectors.length > 1 && sectors[sectors.length - 1];
  return (
    <div className="vg-card">
      <div className="vg-kicker">Market context</div>
      <div className="vg-note" style={{ fontSize: 12, margin: "2px 0 10px" }}>
        The whole-market read behind today's bias — breadth, volatility term structure,
        sector rotation, and the cross-asset backdrop. Context only (ADR-008).
      </div>
      <div className="vg-mc-grid">
        {breadth != null && (
          <div className="vg-mc-block">
            <div className="vg-mc-hd">Breadth</div>
            <div className="vg-mc-big">{breadth}% <span className="vg-note" style={{ fontSize: 12 }}>above 50-day</span></div>
            <div className="vg-note" style={{ fontSize: 12 }}>
              A/D {reg.breadth_ad_ratio ?? "—"}
            </div>
            {breadthNote && <div className="vg-mc-edge">{breadthNote}</div>}
          </div>
        )}
        {reg.vix != null && (
          <div className="vg-mc-block">
            <div className="vg-mc-hd">Volatility</div>
            <div className="vg-mc-big">VIX {fmtP(reg.vix)} <span className="vg-note" style={{ fontSize: 12 }}>{reg.vix_band || ""}</span></div>
            {stance && (
              <div className="vg-note" style={{ fontSize: 12 }}>
                term structure {stance}{reg.vix_contango != null ? ` (${reg.vix_contango > 0 ? "+" : ""}${reg.vix_contango} vs VIX3M)` : ""}
              </div>
            )}
            {termNote && <div className="vg-mc-edge">{termNote}</div>}
          </div>
        )}
        {lead && (
          <div className="vg-mc-block">
            <div className="vg-mc-hd">Sector rotation</div>
            <div style={{ fontSize: 14 }}>
              ▲ {lead.name} <span className="vg-note">{lead.ret_20d_pct != null ? `+${lead.ret_20d_pct}% 20d` : ""}</span>
            </div>
            {lag && <div style={{ fontSize: 14 }}>
              ▼ {lag.name} <span className="vg-note">{lag.ret_20d_pct != null ? `${lag.ret_20d_pct}% 20d` : ""}</span>
            </div>}
          </div>
        )}
        {im.available && (
          <div className="vg-mc-block">
            <div className="vg-mc-hd">Intermarket</div>
            {[["DXY", im.dxy], ["10Y", im.tnx], ["Oil", im.oil], ["Gold", im.gold]].map(([l, o]) => imRow(l, o))}
          </div>
        )}
      </div>
    </div>
  );
}

// Ticket modal: stage a reclaim order ticket at a playbook level. The server
// computes entry/stop/target ladder + risk-based qty (an index symbol comes
// back rescaled into its tradeable proxy ETF, e.g. SPX→SPY at the live ratio).
// STAGED ONLY — the operator copies it into their broker; Vantage never places
// orders (ADR-010).
// From a FIRED signal (Today view), two extras travel with the ticket:
//   `signalPaperId` — links the managed position back to its signal (the
//     signal↔live correlation join);
//   `seed.entry`    — the reclaim CLOSE the signal actually fired at. The
//     ticket must price from there, not from the level: the tape has already
//     left the level behind, so a limit resting there may never fill, and the
//     R:R would not be the one the signal promised.
export function TicketModal({ sym, spot, seed, onClose, signalPaperId }) {
  // side default: role if the level has one, else by position vs spot
  // (below spot = buy-the-dip long; above = fade-the-rally short).
  const defSide = seed.role === "support" ? "long"
    : seed.role === "resistance" ? "short"
    : (spot != null && seed.level > spot ? "short" : "long");
  const [side, setSide] = useState(defSide);
  const [risk, setRisk] = useState(500);
  const [res, setRes] = useState(null);   // {loading} | {ticket, text} | {error, note}
  const [copied, setCopied] = useState(false);
  // execute flow (ADR-010 v2): dry-run → arm → live. Account persists locally.
  const [account, setAccount] = useState(
    () => { try { return localStorage.getItem("vantage.exec.account") || ""; } catch (e) { return ""; } });
  const [policy, setPolicy] = useState("ladder");
  const [exec, setExec] = useState(null);  // {loading} | envelope | {error, note}
  const [armed, setArmed] = useState(false);

  const stage = async () => {
    setRes({ loading: true });
    setCopied(false);
    setExec(null); setArmed(false);
    const v = await getTicket(sym, side, seed.level, risk || 0, seed.entry || null);
    setRes(v.available ? { ticket: v.ticket, text: v.text } : { error: true, note: v.note });
  };

  const runExecute = async (live) => {
    try { localStorage.setItem("vantage.exec.account", account); } catch (e) { /* private mode */ }
    setExec({ loading: true });
    setArmed(false);
    const v = await executeTicket({
      symbol: sym, side, level: seed.level, risk: risk || 0,
      account_number: account, exit_policy: policy, live: !!live,
      ...(seed.entry ? { entry: seed.entry } : {}),
      ...(signalPaperId ? { signal_paper_id: signalPaperId } : {}),
    });
    setExec(v && v.available ? v : { error: true, note: (v && v.note) || "execute failed" });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText((res && res.text) || ""); setCopied(true); }
    catch (e) { setCopied(false); }
  };

  const tk = res && res.ticket;
  const o = tk && tk.orders;
  return (
    <div className="vg-modal-backdrop" onClick={onClose}>
      <div className="vg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="vg-kicker" style={{ margin: 0 }}>
            Stage ticket · {sym} {fmtP(seed.level)}{seed.kind ? ` · ${seed.kind}` : ""}
          </div>
          <button className="vg-linkbtn" onClick={onClose}>close</button>
        </div>

        <div className="vg-row" style={{ gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="vg-symsw" role="tablist" aria-label="side">
            {["long", "short"].map((s) => (
              <button key={s} role="tab" aria-selected={s === side}
                className={cls("vg-symsw-btn", s === side && "on")}
                onClick={() => setSide(s)}>{s === "long" ? "Long (reclaim)" : "Short (fade)"}</button>
            ))}
          </div>
          <label className="vg-note" style={{ fontSize: 13 }}>
            risk $<input type="number" min="1" step="50" value={risk}
              style={{ width: 70, marginLeft: 4 }}
              onChange={(e) => setRisk(Number(e.target.value))} />
          </label>
          <button className="vg-btn-sm" onClick={stage}
            disabled={res && res.loading}>{res && res.loading ? "Staging…" : "Stage"}</button>
        </div>

        {res && res.error && (
          <p className="vg-note" style={{ margin: "10px 0" }}>{res.note}</p>
        )}
        {tk && (
          <>
            {tk.derived_from && (
              <p className="vg-note" style={{ margin: "10px 0 0", fontSize: 13 }}>
                {tk.derived_from.index} is an index — staged in <b>{tk.symbol}</b> at the
                live ratio {tk.derived_from.ratio.toFixed(5)}.
              </p>
            )}
            <table className="vg-table" style={{ marginTop: 8, fontSize: 14 }}>
              <tbody>
                <tr><td>Entry</td>
                  <td>{o.entry.action} <b>{o.entry.qty}</b> @ <b>{o.entry.price}</b> limit</td></tr>
                <tr><td>Stop</td>
                  <td>{o.stop.action} {o.stop.qty} @ <b>{o.stop.price}</b> stop
                    <span className="vg-note"> · max loss {tk.risk.max_loss_at_stop}</span></td></tr>
                {o.targets.map((t) => (
                  <tr key={t.name}><td>{t.name}</td>
                    <td>{o.stop.action} {t.qty} @ <b>{t.price}</b> limit
                      {t.risk_reward != null && <span className="vg-note"> · R:R {t.risk_reward}</span>}</td></tr>
                ))}
              </tbody>
            </table>
            {!tk.sized && (
              <p className="vg-note" style={{ margin: "8px 0 0" }}>
                Risk budget too small for 1 share at this stop distance.
              </p>
            )}
            <p className="vg-note" style={{ margin: "8px 0", fontSize: 12 }}>
              Staged. Place manually (Copy as text), or execute below — the gated
              ADR-010 v2 path: the server recomputes this ticket and submits entry +
              GTC stop to Robinhood; targets/trailing are managed by the exit monitor.
            </p>
            <div className="vg-row" style={{ gap: 8 }}>
              <button className="vg-btn-sm" onClick={copy}>{copied ? "Copied ✓" : "Copy as text"}</button>
            </div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--lk-border, #333)" }}>
              <div className="vg-kicker" style={{ margin: "0 0 8px", fontSize: 12 }}>Execute · Robinhood</div>
              <div className="vg-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label className="vg-note" style={{ fontSize: 13 }}>
                  account #<input value={account} placeholder="agentic-allowed acct"
                    style={{ width: 110, marginLeft: 4 }}
                    onChange={(e) => setAccount(e.target.value.trim())} />
                </label>
                <div className="vg-symsw" role="tablist" aria-label="exit policy">
                  {["ladder", "trailing"].map((p) => (
                    <button key={p} role="tab" aria-selected={p === policy}
                      className={cls("vg-symsw-btn", p === policy && "on")}
                      title={p === "ladder"
                        ? "validated: stop rests; monitor swaps to the T1 target"
                        : "opt-in: monitor ratchets the stop by the initial stop distance"}
                      onClick={() => setPolicy(p)}>{p}</button>
                  ))}
                </div>
                <button className="vg-btn-sm" disabled={!account || (exec && exec.loading)}
                  onClick={() => runExecute(false)}>
                  {exec && exec.loading ? "Executing…" : "Dry-run"}
                </button>
                {exec && exec.execution && exec.execution.mode === "dry_run" && !armed && (
                  <button className="vg-btn-sm" onClick={() => setArmed(true)}>Arm live…</button>
                )}
                {armed && (
                  <button className="vg-btn-sm" style={{ borderColor: "#c0392b", color: "#c0392b" }}
                    onClick={() => runExecute(true)}>CONFIRM LIVE EXECUTE</button>
                )}
              </div>

              {exec && exec.error && (
                <p className="vg-note" style={{ margin: "8px 0 0" }}>{exec.note}</p>
              )}
              {exec && exec.execution && (
                <div style={{ marginTop: 8 }}>
                  <p className="vg-note" style={{ margin: 0, fontSize: 13 }}>
                    <b>{exec.execution.mode === "live" ? "LIVE" : "dry run"}</b>
                    {" · "}{exec.execution.legs.length} leg(s)
                    {exec.execution.managed_position_id != null &&
                      <> · managed position #{exec.execution.managed_position_id} → see Managed Exits</>}
                  </p>
                  <table className="vg-table" style={{ marginTop: 6, fontSize: 13 }}>
                    <tbody>
                      {exec.execution.legs.map((l, i) => (
                        <tr key={i}><td>{l.leg}</td>
                          <td>{l.side} {l.quantity} {l.type}
                            {l.limit_price != null && <> @ {l.limit_price}</>}
                            {l.stop_price != null && <> stop {l.stop_price}</>}
                            {" · "}{l.status}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {(exec.execution.warnings || []).map((w, i) => (
                    <p key={i} className="vg-note" style={{ margin: "4px 0 0", fontSize: 12 }}>⚠ {w}</p>
                  ))}
                </div>
              )}
              <p className="vg-note" style={{ margin: "8px 0 0", fontSize: 12 }}>
                Dry-run always; live needs the confirm AND server env VANTAGE_LIVE_OK=1.
                Keep the exit monitor running while a live position is open.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Export modal: shows the generated Pine v5 script with copy-to-clipboard and the
// TradingView paste note. The script is externally-computed context (levels baked
// nightly; only the price-vs-flip regime is live) — the caveats ride in the script.
export function PineModal({ pine, session, onClose, title = "TradingView Pine", symbol = "SPX" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(pine.script || ""); setCopied(true); }
    catch (e) { setCopied(false); }
  };
  return (
    <div className="vg-modal-backdrop" onClick={onClose}>
      <div className="vg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="vg-kicker" style={{ margin: 0 }}>
            {title}{session ? ` · ${session}` : ""}
          </div>
          <button className="vg-linkbtn" onClick={onClose}>close</button>
        </div>
        {pine.loading && <p className="vg-note" style={{ margin: "10px 0" }}>Generating script…</p>}
        {pine.error && <p className="vg-note" style={{ margin: "10px 0" }}>
          No script — regenerate the levels first.</p>}
        {pine.script && (
          <>
            <p className="vg-note" style={{ margin: "8px 0" }}>
              Copy → TradingView <b>Pine Editor</b> → Add to chart on a <b>{symbol}</b> chart.
              Levels &amp; setups are baked from the latest data; the green/red background and
              the arrows update live off price vs the gamma flip. <b>Not financial advice</b> —
              conditional context, and the GEX read is 0DTE-blind.
            </p>
            <textarea className="vg-pine-box" readOnly value={pine.script}
              onFocus={(e) => e.target.select()} rows={16} />
            <div className="vg-row" style={{ gap: 8, marginTop: 8 }}>
              <button className="vg-btn-sm" onClick={copy}>{copied ? "Copied ✓" : "Copy script"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
