// PlaybookView — the daily 0DTE SPX playbook (Intelligence nav).
// SPX is not a holding, so this is its own top-level view (not a ticker
// notebook). It shows: a pinned regime summary (gamma · flip · walls ·
// catalyst), the plain-English narrative (Mira's LLM polish of the templated
// scaffold), and collapsible structured sections (level ladder, conditional
// setups, lookback edges). Refreshed nightly by the Vantage batch; the view
// reads the latest. Context, not a signal (ADR-008) — no orders placed.
import { cls, SymbolSwitcher } from "./util.jsx";
import { Term, GlossaryCard } from "./glossary.jsx";
import { useLive, getPlaybook, getPlaybookPine, recomputePlaybook } from "./live.js";

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
            <button className="vg-btn-sm" style={{ background: "#fff", color: "var(--color-primary)" }}
              disabled={busy} onClick={recompute}>{busy ? "Recomputing…" : "Recompute"}</button>
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

      {cat.today && (
        <div className="vg-pb-catalyst">
          ⚠️ Catalyst today: <b>{cat.today}</b> — expect bigger moves; size down.
        </div>
      )}

      {/* ---- the plain-English narrative ---- */}
      <div className="vg-card">
        <div className="vg-kicker">Today's read</div>
        {p && p.narrative
          ? <div className="vg-pb-narrative" style={{ whiteSpace: "pre-wrap" }}>{p.narrative}</div>
          : <p className="vg-note" style={{ margin: "6px 0 0" }}>
              {pb.loading ? "Generating the read…" : "No narrative available."}
            </p>}
        {p && p.structureNote && (
          <div className="vg-note" style={{ marginTop: 8, fontSize: 12 }}>
            <b>Structure:</b> {p.structureNote}
          </div>
        )}
        {p && p.volumeNote && (
          <div className="vg-note" style={{ marginTop: 2, fontSize: 12 }}>
            <b>Volume:</b> {p.volumeNote}
          </div>
        )}
      </div>

      {/* ---- plain-English explanation of today's regime + how to trade it ---- */}
      {p && reg.gamma && (
        <PlainEnglish reg={reg} keyLevels={keyLevels} />
      )}

      {/* ---- durable memory levels (respected across many sessions) ---- */}
      {p && p.durable && p.durable.length > 0 && (
        <div className="vg-card">
          <div className="vg-kicker">Durable levels ★ (memory)</div>
          <div className="vg-note" style={{ fontSize: 11, margin: "2px 0 8px" }}>
            Levels the tape kept respecting across many sessions — the "traces back weeks" levels.
          </div>
          <div className="vg-pb-ladder">
            {p.durable.map((z, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn")}
                  style={{ minWidth: 62, textAlign: "right" }}>
                  {fmtP(z.price)}
                </span>
                <span style={{ fontSize: 13 }}>{z.kind || `durable ${z.role}`}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>
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
          <div className="vg-note" style={{ fontSize: 11, margin: "2px 0 8px" }}>
            Bands where 2+ dimensions (GEX wall / fib / PoC / S-R) line up — the high-signal levels.
          </div>
          <div className="vg-pb-ladder">
            {p.confluence.map((z, i) => (
              <div key={i} className="vg-pb-lvl">
                <span className={cls("vg-badge", z.role === "support" ? "good" : z.role === "resistance" ? "bad" : "warn")}
                  style={{ minWidth: 62, textAlign: "right" }}>
                  {fmtP(z.price)}
                </span>
                <span style={{ fontSize: 13 }}>{(z.kinds || []).slice(0, 3).join(" + ")}</span>
                <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>
                  {z.role}{z.strength ? ` · ${z.strength} dims` : ""}
                </span>
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
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{su.structure}</div>
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
                <span style={{ fontSize: 13 }}>{r.kind}</span>
                {r.source && <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>{r.source}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ---- lookback edges (collapsible) ---- */}
      {p && p.edges && (p.edges.gex_regime_next_day_range || p.edges.day_time) && (
        <details className="vg-card">
          <summary className="vg-kicker" style={{ cursor: "pointer" }}>Lookback edges</summary>
          <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
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

// "Today, in plain English" — turns the regime + key levels into a readable
// story with hoverable jargon, so a non-options reader knows what to actually do.
function PlainEnglish({ reg, keyLevels }) {
  const pos = reg.gamma === "positive";
  const spot = reg.spot;
  const { flip, call, put } = keyLevels;
  return (
    <div className="vg-card">
      <div className="vg-kicker">Today, in plain English</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 6 }}>
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
      <div className="vg-note" style={{ fontSize: 11 }}>{label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}

// Export modal: shows the generated Pine v5 script with copy-to-clipboard and the
// TradingView paste note. The script is externally-computed context (levels baked
// nightly; only the price-vs-flip regime is live) — the caveats ride in the script.
function PineModal({ pine, session, onClose }) {
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
            TradingView Pine{session ? ` · ${session}` : ""}
          </div>
          <button className="vg-linkbtn" onClick={onClose}>close</button>
        </div>
        {pine.loading && <p className="vg-note" style={{ margin: "10px 0" }}>Generating script…</p>}
        {pine.error && <p className="vg-note" style={{ margin: "10px 0" }}>
          No script — generate the playbook first (Recompute, or the nightly job).</p>}
        {pine.script && (
          <>
            <p className="vg-note" style={{ margin: "8px 0" }}>
              Copy → TradingView <b>Pine Editor</b> → Add to chart on an <b>SPX</b> chart.
              Levels &amp; setups are baked from tonight's data; the green/red background and
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
