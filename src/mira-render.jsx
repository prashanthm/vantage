// mira-render — the SHARED, extensible renderer for Mira/LLM output across
// Vantage. One robust parser + one generic component so every section that shows
// Mira output renders the same way (and degrades to clean prose when the model
// doesn't return JSON).
//
// THE GENERIC SHAPE (extensible — add `kind`s as needed, older UIs ignore them):
//   {
//     "headline": "one-line takeaway",
//     "sections": [
//       { "kind": "prose",    "title?": "...", "text": "paragraph(s)" },
//       { "kind": "list",     "title": "...", "items": [ {point, cites?} | "str" ] },
//       { "kind": "keyvals",  "title": "...", "rows": [ {k, v, tone?} ] },
//       { "kind": "callout",  "title": "...", "text": "...", "tone?": "good|bad|warn" },
//       { "kind": "donext",   "title?": "Do next", "items": [ {title, detail?} ] },
//       { "kind": "swot",     "swot": { strengths[], weaknesses[], opportunities[], threats[] } },
//       { "kind": "scorecard","rows": [ {label, score, status?, delta?} ] }
//     ]
//   }
//
// SWOT is now just one section kind — not the whole schema. parseMira() extracts
// this object from an LLM string (fences → first balanced {…} → shape check),
// and MiraRender renders it; when neither validates, callers show prose.
import { cls } from "./util.jsx";

const { useMemo } = React;

// ── parsing ──────────────────────────────────────────────────────────────────

// Extract the first balanced top-level JSON object from an LLM string, tolerating
// ```json fences and prose before/after. Returns the object or null.
export function extractJson(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); }
  catch { return null; }
}

// A generic Mira object is valid to render if it has a headline OR at least one
// renderable section (or a legacy top-level swot). Otherwise → prose fallback.
export function validateMira(o) {
  if (!o || typeof o !== "object") return false;
  if (isSwot(o.swot)) return true;                 // legacy {swot:{…}} shape
  if (typeof o.headline === "string" && o.headline.trim()) return true;
  return Array.isArray(o.sections) && o.sections.some(isRenderableSection);
}

// Parse an LLM reply into a renderable Mira object, or null (→ render prose).
// Also normalizes the legacy {headline, swot, pattern, scores_read, do_next}
// journal shape into the generic {headline, sections[]} form.
export function parseMira(text) {
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
    case "swot": return isSwot(s.swot);
    case "list": case "donext": return Array.isArray(s.items) && s.items.length > 0;
    case "keyvals": case "scorecard": return Array.isArray(s.rows) && s.rows.length > 0;
    case "callout": case "prose": return typeof s.text === "string" && s.text.trim().length > 0;
    default: return false;
  }
}

// Fold the legacy journal shape into generic sections so one renderer covers both.
function normalize(o) {
  if (Array.isArray(o.sections)) return o;   // already generic
  const sections = [];
  if (isSwot(o.swot)) sections.push({ kind: "swot", swot: o.swot });
  if (o.pattern) sections.push({ kind: "callout", title: "The pattern", text: String(o.pattern) });
  if (o.scores_read) sections.push({ kind: "prose", text: String(o.scores_read) });
  if (Array.isArray(o.do_next) && o.do_next.length) sections.push({ kind: "donext", items: o.do_next });
  return { headline: o.headline, sections };
}

// ── rendering ──────────────────────────────────────────────────────────────

const SWOT_QUADS = [
  { key: "strengths", kind: "s", title: "Strengths", tag: "keep" },
  { key: "weaknesses", kind: "w", title: "Weaknesses", tag: "fix" },
  { key: "opportunities", kind: "o", title: "Opportunities", tag: "capture" },
  { key: "threats", kind: "t", title: "Threats", tag: "guard" },
];

function normItem(it) {
  return typeof it === "string" ? { point: it, cites: [] } : (it || { point: "" });
}

function SwotQuad({ kind, title, tag, items }) {
  return (
    <div className={cls("vg-swot-q", kind)}>
      <div className="vg-swot-head">
        <span className="vg-swot-badge">{kind.toUpperCase()}</span>
        <b>{title}</b><span className="vg-note vg-swot-tag">{tag}</span>
      </div>
      {items.length ? (
        <ul className="vg-swot-items">
          {items.map(normItem).map((it, i) => (
            <li key={i}>
              <span>{it.point}</span>
              {Array.isArray(it.cites) && it.cites.length > 0 && (
                <span className="vg-swot-cites">
                  {it.cites.map((c, j) => <span key={j} className={cls("vg-cite", kind)}>{c}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="vg-note" style={{ margin: "4px 0 0", fontSize: 13 }}>none noted this window</p>}
    </div>
  );
}

// Public: the SWOT grid on its own (kept so existing callers keep working).
export function SwotRender({ swot }) {
  const s = (swot && swot.swot) || swot || {};
  return (
    <div className="vg-swot vg-swot-grid">
      {SWOT_QUADS.map((q) => (
        <SwotQuad key={q.key} kind={q.kind} title={q.title} tag={q.tag} items={s[q.key] || []} />
      ))}
    </div>
  );
}

const TONE = { good: "vg-up", bad: "vg-down", warn: "vg-warn" };

function Section({ s }) {
  if (s.kind === "swot") {
    return (
      <div className="vg-mr-section">
        {s.title && <div className="vg-kicker">{s.title}</div>}
        <SwotRender swot={s.swot} />
      </div>
    );
  }
  if (s.kind === "prose") {
    return (
      <div className="vg-mr-section">
        {s.title && <div className="vg-kicker">{s.title}</div>}
        <p className="vg-mr-prose" style={{ whiteSpace: "pre-wrap", margin: s.title ? "4px 0 0" : 0 }}>{s.text}</p>
      </div>
    );
  }
  if (s.kind === "callout") {
    return (
      <div className={cls("vg-mr-callout", s.tone && `t-${s.tone}`)}>
        {s.title && <span className="vg-kicker" style={{ margin: 0 }}>{s.title}</span>}
        <p style={{ margin: s.title ? "4px 0 0" : 0 }}>{s.text}</p>
      </div>
    );
  }
  if (s.kind === "list") {
    return (
      <div className="vg-mr-section">
        {s.title && <div className="vg-kicker">{s.title}</div>}
        <ul className="vg-mr-list">
          {s.items.map(normItem).map((it, i) => (
            <li key={i}>
              <span>{it.point}</span>
              {Array.isArray(it.cites) && it.cites.length > 0 && (
                <span className="vg-swot-cites">
                  {it.cites.map((c, j) => <span key={j} className="vg-cite">{c}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (s.kind === "donext") {
    return (
      <div className="vg-mr-section">
        <div className="vg-kicker">{s.title || "Do this next"}</div>
        <ol className="vg-donext">
          {s.items.map((d, i) => {
            const item = typeof d === "string" ? { title: d } : (d || {});
            return <li key={i}><b>{item.title}</b>{item.detail ? <> — <span className="vg-note">{item.detail}</span></> : null}</li>;
          })}
        </ol>
      </div>
    );
  }
  if (s.kind === "keyvals") {
    return (
      <div className="vg-mr-section">
        {s.title && <div className="vg-kicker">{s.title}</div>}
        <table className="vg-mini" style={{ marginTop: 4 }}><tbody>
          {s.rows.map((r, i) => (
            <tr key={i}>
              <td style={{ width: 110 }}><b>{r.k}</b></td>
              <td className={cls(r.tone && TONE[r.tone])}>{r.v}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    );
  }
  if (s.kind === "scorecard") {
    const tone = (n) => (n >= 70 ? "good" : n >= 45 ? "warn" : "bad");
    return (
      <div className="vg-mr-section">
        {s.title && <div className="vg-kicker">{s.title}</div>}
        <div className="vg-scores">
          {s.rows.map((r, i) => (
            <div key={i} className="vg-score">
              <div className="vg-spread" style={{ alignItems: "baseline" }}>
                <span style={{ fontSize: 14 }}>{r.label}</span>
                <b className={cls("vg-score-n", `vg-${tone(r.score)}`)}>{r.score}</b>
              </div>
              <div className="vg-score-track"><div className={cls("vg-score-fill", `bg-${tone(r.score)}`)} style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

// Public: render a generic Mira object. Pass either a pre-parsed object (`data`)
// or a raw LLM string (`text`) — text is parsed with parseMira. When neither
// yields a renderable object, renders the `text` as clean prose (the fallback),
// so a caller can always just do <MiraRender text={reply} />.
export function MiraRender({ data, text }) {
  const obj = useMemo(() => data || parseMira(text), [data, text]);
  if (!obj) {
    // prose fallback — never a blank panel
    return <div className="vg-mr-prose" style={{ whiteSpace: "pre-wrap" }}>{text || ""}</div>;
  }
  const sections = obj.sections || [];
  return (
    <div className="vg-mr">
      {obj.headline && <h3 className="vg-mr-headline">{obj.headline}</h3>}
      {sections.filter(isRenderableSection).map((s, i) => <Section key={i} s={s} />)}
    </div>
  );
}
