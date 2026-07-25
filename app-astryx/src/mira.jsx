// Mira output: one robust parser + one Astryx renderer for the generic schema
// {headline, sections:[{kind: prose|list|keyvals|callout|donext|swot|scorecard}]}.
// Parser functions are ported verbatim from src/mira-render.jsx (pure); the
// renderer is re-expressed in Astryx components. Malformed/absent JSON
// degrades to clean prose — the operator always gets a result.
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";

// ── parsing (pure, ported) ──────────────────────────────────────────────────
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

export function validateMira(o) {
  if (!o || typeof o !== "object") return false;
  if (isSwot(o.swot)) return true;
  if (typeof o.headline === "string" && o.headline.trim()) return true;
  return Array.isArray(o.sections) && o.sections.some(isRenderableSection);
}

function normalize(o) {
  if (Array.isArray(o.sections)) return o;
  const sections = [];
  if (isSwot(o.swot)) sections.push({ kind: "swot", swot: o.swot });
  if (o.pattern) sections.push({ kind: "callout", title: "The pattern", text: String(o.pattern) });
  if (o.scores_read) sections.push({ kind: "prose", text: String(o.scores_read) });
  if (Array.isArray(o.do_next) && o.do_next.length) sections.push({ kind: "donext", items: o.do_next });
  return { headline: o.headline, sections };
}

export function parseMira(text) {
  const o = extractJson(text);
  if (!o || !validateMira(o)) return null;
  return normalize(o);
}

// ── rendering (Astryx) ──────────────────────────────────────────────────────
const TONE_BADGE = { good: "success", bad: "error", warn: "warning" };
const normItem = (it) => (typeof it === "string" ? { point: it, cites: [] } : (it || { point: "" }));

const SWOT_QUADS = [
  { key: "strengths", title: "Strengths", tag: "keep", v: "success" },
  { key: "weaknesses", title: "Weaknesses", tag: "fix", v: "error" },
  { key: "opportunities", title: "Opportunities", tag: "capture", v: "info" },
  { key: "threats", title: "Threats", tag: "guard", v: "warning" },
];

export function SwotView({ swot }) {
  const s = (swot && swot.swot) || swot || {};
  return (
    <div className="vg-cols">
      {SWOT_QUADS.map((q) => (
        <VStack key={q.key} gap={1}>
          <HStack gap={1} align="center">
            <Badge variant={q.v} label={q.title} />
            <Text type="supporting" color="secondary">{q.tag}</Text>
          </HStack>
          {(s[q.key] || []).map(normItem).map((it, i) => (
            <Text key={i} type="supporting">
              {it.point}
              {Array.isArray(it.cites) && it.cites.length > 0 && (
                <Text type="supporting" color="secondary"> · {it.cites.join(" · ")}</Text>
              )}
            </Text>
          ))}
          {!(s[q.key] || []).length && <Text type="supporting" color="secondary">—</Text>}
        </VStack>
      ))}
    </div>
  );
}

function SectionView({ s }) {
  switch (s.kind) {
    case "swot": return <SwotView swot={s.swot} />;
    case "prose": return (
      <VStack gap={1}>
        {s.title && <Text type="label" color="secondary">{s.title}</Text>}
        <Text type="supporting" style={{ whiteSpace: "pre-wrap" }}>{s.text}</Text>
      </VStack>
    );
    case "callout": return (
      <Banner status={s.tone === "bad" ? "error" : s.tone === "warn" ? "warning" : s.tone === "good" ? "success" : "info"}
        title={s.title || ""} description={s.text} />
    );
    case "list": return (
      <VStack gap={1}>
        {s.title && <Text type="label" color="secondary">{s.title}</Text>}
        {(s.items || []).map(normItem).map((it, i) => (
          <Text key={i} type="supporting">• {it.point}</Text>
        ))}
      </VStack>
    );
    case "keyvals": return (
      <VStack gap={1}>
        {s.title && <Text type="label" color="secondary">{s.title}</Text>}
        {(s.rows || []).map((r, i) => (
          <HStack key={i} gap={2} align="baseline" wrap="wrap">
            {r.tone && TONE_BADGE[r.tone]
              ? <Badge variant={TONE_BADGE[r.tone]} label={r.k} />
              : <Text type="supporting" weight="semibold">{r.k}</Text>}
            <Text type="supporting">{r.v}</Text>
          </HStack>
        ))}
      </VStack>
    );
    case "donext": return (
      <VStack gap={1}>
        <Text type="label" color="secondary">{s.title || "Do next"}</Text>
        {(s.items || []).map((it, i) => (
          <Text key={i} type="supporting">
            <b>{it.title || it.point || ""}</b>{it.detail ? ` — ${it.detail}` : ""}
          </Text>
        ))}
      </VStack>
    );
    case "scorecard": return (
      <VStack gap={1}>
        {s.title && <Text type="label" color="secondary">{s.title}</Text>}
        {(s.rows || []).map((r, i) => (
          <HStack key={i} gap={2} align="center">
            <Text type="supporting" weight="semibold">{r.label}</Text>
            <Text type="supporting">{r.score}</Text>
            {r.delta != null && <Text type="supporting" color={r.delta >= 0 ? "success" : "error"}>
              {r.delta >= 0 ? "+" : ""}{r.delta}</Text>}
          </HStack>
        ))}
      </VStack>
    );
    default: return null;
  }
}

// The one renderer: structured when data validates, clean prose otherwise.
export function MiraView({ data, text }) {
  const d = data || parseMira(text);
  if (!d) {
    return <Text type="supporting" style={{ whiteSpace: "pre-wrap" }}>{text || ""}</Text>;
  }
  return (
    <VStack gap={2}>
      {d.headline && <Text type="body" weight="semibold">{d.headline}</Text>}
      {(d.sections || []).filter(isRenderableSection).map((s, i) => <SectionView key={i} s={s} />)}
    </VStack>
  );
}
