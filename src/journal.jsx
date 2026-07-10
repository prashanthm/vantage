// JournalView — chart-snapshot journal: forecast vs. what happened (Intelligence).
// Drop or paste a TradingView screenshot; it's saved WITH the playbook forecast
// that was live then, and later scored against real price action (which levels
// held/broke, was the regime call right). Over time this is an evidence-based
// confidence read on the projections. Journal/analysis only — no orders (ADR-010).
import { cls } from "./util.jsx";
import {
  useLive, getJournal, uploadJournal, scoreJournal, deleteJournal, journalImageUrl,
} from "./live.js";

const { useState, useRef, useEffect } = React;

const pct = (v) => (v == null ? "—" : `${Math.round(100 * v)}%`);
const when = (iso) => {
  if (!iso) return "";
  try { const d = new Date(iso); return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch (e) { return iso; }
};

const VERDICT_TONE = { held: "good", broken: "bad", tested: "warn", untested: "plain" };

export function JournalView({ refreshNonce }) {
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  const jv = useLive(() => getJournal(), null, [refreshNonce, nonce]);
  const d = jv.data;
  const reload = () => setNonce((n) => n + 1);

  const doUpload = async (fileOrBlob) => {
    if (!fileOrBlob) return;
    setBusy("upload");
    await uploadJournal(fileOrBlob, note);
    setBusy(""); setNote(""); reload();
  };
  const doScore = async () => { setBusy("score"); await scoreJournal(); setBusy(""); reload(); };
  const doDelete = async (id) => { setBusy(`del${id}`); await deleteJournal(id); setBusy(""); reload(); };

  // clipboard paste anywhere on the screen while mounted
  useEffect(() => {
    const onPaste = (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const blob = it.getAsFile();
          if (blob) { doUpload(blob); e.preventDefault(); return; }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) doUpload(f);
  };

  if (d && d.available === false) {
    return (
      <div className="vg-pane-body">
        <h2 style={{ margin: "0 0 6px", fontSize: 19 }}>Journal</h2>
        <p className="vg-note">{d.note || "Journal needs the SQLite backend + a generated playbook."}</p>
      </div>
    );
  }

  const snaps = (d && d.snapshots) || [];
  const acc = (d && d.accuracy) || {};

  return (
    <div className="vg-pane-body vg-playbook">
      <div className="vg-pb-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Chart journal <span className="vg-note" style={{ fontSize: 12, fontWeight: 400 }}>· forecast vs. outcome</span></h2>
          <div className="vg-note">
            {d ? `${snaps.length} snapshot${snaps.length === 1 ? "" : "s"}` : "loading…"}
          </div>
          <div className="vg-row" style={{ gap: 6, marginTop: 8 }}>
            <button className="vg-btn-sm" disabled={busy === "score"} onClick={doScore}>
              {busy === "score" ? "Scoring…" : "Score vs. price"}
            </button>
          </div>
        </div>
        {acc.n_scored > 0 && (
          <div className="vg-pb-levels">
            <Tile label="Level accuracy" value={pct(acc.avg_level_accuracy)} tone={acc.avg_level_accuracy >= 0.5 ? "good" : "bad"} />
            <Tile label="Regime calls right" value={pct(acc.regime_hit_rate)} tone={acc.regime_hit_rate >= 0.5 ? "good" : "bad"} />
            <Tile label="Scored" value={acc.n_scored} />
          </div>
        )}
      </div>

      {/* upload / paste box */}
      <div className="vg-card"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)} onDrop={onDrop}
        style={{ border: drag ? "2px dashed var(--color-primary)" : "2px dashed var(--color-border, #ccc)",
                 textAlign: "center", padding: 18, cursor: "pointer" }}
        onClick={() => fileRef.current && fileRef.current.click()}>
        <div style={{ fontSize: 14 }}>
          {busy === "upload" ? "Uploading…" : "Drop a chart screenshot here, paste (⌘V), or click to choose a file"}
        </div>
        <div className="vg-note" style={{ fontSize: 11, marginTop: 4 }}>
          It's saved with today's playbook forecast so you can score it later.
        </div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => doUpload(e.target.files && e.target.files[0])} />
      </div>
      <input className="vg-input" placeholder="Optional note for the next snapshot (e.g. 'broke 7547 and ran')"
        value={note} onChange={(e) => setNote(e.target.value)}
        style={{ width: "100%", padding: "6px 8px", marginTop: 4, fontSize: 13 }} />

      {/* timeline */}
      {snaps.map((s) => (
        <div key={s.id} className="vg-card">
          <div className="vg-row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
            <div className="vg-kicker" style={{ margin: 0 }}>
              {when(s.created_at)}{s.session ? ` · ${s.session} playbook` : ""}
            </div>
            <button className="vg-linkbtn" disabled={busy === `del${s.id}`} onClick={() => doDelete(s.id)}>
              {busy === `del${s.id}` ? "…" : "delete"}
            </button>
          </div>
          {s.note && <div style={{ fontSize: 13, margin: "4px 0" }}>{s.note}</div>}
          <img src={journalImageUrl(s.id)} alt="chart snapshot"
            style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6, display: "block" }} />

          {/* the forecast that was live */}
          {s.forecast && s.forecast.plan && (
            <div className="vg-note" style={{ fontSize: 12, marginTop: 8 }}>
              <b>Forecast then:</b> {s.forecast.gamma} gamma · {s.forecast.plan}
            </div>
          )}

          {/* the scorecard */}
          {s.scorecard ? (
            <div style={{ marginTop: 8 }}>
              <div className="vg-note" style={{ fontSize: 11, marginBottom: 4 }}>
                WHAT HAPPENED — price {s.scorecard.price_low}–{s.scorecard.price_high}
                {s.scorecard.regime && <> · regime call{" "}
                  <b className={s.scorecard.regime.correct ? "up" : "down"}>
                    {s.scorecard.regime.correct ? "✓ right" : "✗ wrong"}</b>
                  {" "}({s.scorecard.regime.outcome})</>}
                {s.scorecard.level_accuracy != null && <> · levels {pct(s.scorecard.level_accuracy)}</>}
              </div>
              <div className="vg-pb-ladder">
                {(s.scorecard.levels || []).filter((l) => l.verdict !== "untested").map((l, i) => (
                  <div key={i} className="vg-pb-lvl">
                    <span className={cls("vg-badge", VERDICT_TONE[l.verdict] || "plain")}
                      style={{ minWidth: 56, textAlign: "center" }}>{l.verdict}</span>
                    <span style={{ fontSize: 13 }}>{l.key} · {Math.round(l.price)} {l.role}</span>
                    <span className="vg-note" style={{ marginLeft: "auto", fontSize: 11 }}>{l.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="vg-note" style={{ fontSize: 11, marginTop: 6 }}>
              Not scored yet — click "Score vs. price" once the session has traded.
            </div>
          )}
        </div>
      ))}

      {snaps.length === 0 && (
        <div className="vg-note" style={{ marginTop: 10 }}>
          No snapshots yet. Drop or paste today's chart above — it'll be saved with the
          current playbook forecast, and you can score it against price later.
        </div>
      )}

      <div className="vg-pb-caveats">
        <div>Each snapshot freezes the playbook forecast that was live; scoring compares it to actual SPX price action.</div>
        <div>Journal / analysis only. Places no orders (ADR-010). Not financial advice.</div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }) {
  return (
    <div className="vg-pb-tile">
      <div className="vg-note" style={{ fontSize: 11 }}>{label}</div>
      <div className={cls("vg-pb-tileval", tone)}>{value}</div>
    </div>
  );
}
