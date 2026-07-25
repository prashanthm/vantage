// Scanner (W4) — the three validated families on the Ledger template.
// Everything the legacy page showed survives: strategy picker, coverage +
// freshness, background refresh with polling, watch tickers, A+/B setup
// cards (entry zone · invalid · exit ladder), and the aged-setup history
// with filters. Every symbol links to its chart (the link contract).
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Link } from "@astryxdesign/core/Link";
import { Section } from "@astryxdesign/core/Section";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { Spinner } from "@astryxdesign/core/Spinner";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Ledger } from "../templates.jsx";
import { links } from "../links.js";
import { backend, getJson, pref, setPref } from "../api.js";

const SCANNERS = [
  { id: "ict_htf", label: "ICT hourly" },
  { id: "breakout_hold", label: "Breakout hold" },
  { id: "rsi2_mr", label: "RSI(2) dip" },
];

const inputStyle = {
  font: "inherit", padding: "5px 9px", borderRadius: 8,
  border: "1px solid var(--color-border)",
  background: "var(--color-background-surface)", color: "var(--color-text-primary)",
};

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const zone = (h) => (Array.isArray(h.entry_zone) && h.entry_zone.length === 2
  ? `${h.entry_zone[0]}–${h.entry_zone[1]}` : (h.ce ?? "—"));
const hhmm = (iso) => String(iso || "").slice(11, 16);

function SetupCard({ h }) {
  const long = h.dir === "long";
  return (
    <Section>
      <VStack gap={1} padding={2}>
        <HStack gap={2} align="center" justify="between">
          <HStack gap={2} align="center">
            <Link href={links.chart(h.symbol)}><Text type="body" weight="semibold">{h.symbol}</Text></Link>
            <Badge variant={long ? "success" : "error"} label={h.dir.toUpperCase()} />
          </HStack>
          <Text type="supporting" color="secondary">
            @ {hhmm(h.as_of)}{h.bars_ago != null ? ` · ${h.bars_ago}h ago` : ""}
          </Text>
        </HStack>
        <HStack gap={3} wrap="wrap">
          <VStack gap={0}>
            <Text type="supporting" color="secondary">entry</Text>
            <Text type="body" weight="semibold">{zone(h)}</Text>
          </VStack>
          <VStack gap={0}>
            <Text type="supporting" color="secondary">invalid</Text>
            <Text type="body" weight="semibold" color="error">{h.invalid ?? "—"}</Text>
          </VStack>
        </HStack>
        {Array.isArray(h.targets) && h.targets.length > 0 && (
          <VStack gap={0}>
            {h.targets.map((t, i) => {
              const runner = i === h.targets.length - 1;
              return (
                <HStack key={i} gap={2} align="center">
                  <Text type="supporting" color="secondary">
                    {runner && h.runner_is_pool ? "draw" : `${t.r ?? "?"}R`}
                  </Text>
                  <Text type="body">{t.price}</Text>
                  {t.size != null && <Text type="supporting" color="secondary">{Math.round(t.size * 100)}%</Text>}
                  {t.note && <Text type="supporting" color="secondary">{t.note}</Text>}
                </HStack>
              );
            })}
          </VStack>
        )}
        {h.note && <Text type="supporting" color="secondary">{h.note}</Text>}
      </VStack>
    </Section>
  );
}

function TierGroup({ label, hits, rationale }) {
  if (!hits.length) return null;
  const side = (name, list) => list.length > 0 && (
    <VStack gap={1}>
      <Text type="supporting" color="secondary">{name} · {list.length}</Text>
      <div className="vg-cols">
        {list.map((h) => <SetupCard key={`${h.symbol}|${h.as_of}`} h={h} />)}
      </div>
    </VStack>
  );
  return (
    <VStack gap={2}>
      <HStack gap={2} align="baseline">
        <Text type="label" color="secondary">{label} · {hits.length}</Text>
        {rationale && <Text type="supporting" color="secondary">{rationale}</Text>}
      </HStack>
      {side("Long", hits.filter((h) => h.dir === "long"))}
      {side("Short", hits.filter((h) => h.dir !== "long"))}
    </VStack>
  );
}

function History({ rows }) {
  const [fq, setFq] = useState("");
  const [fTier, setFTierRaw] = useState(() => pref("scanner.fTier", "all"));
  const setFTier = (v) => { setFTierRaw(v); setPref("scanner.fTier", v); };
  const [fDir, setFDirRaw] = useState(() => pref("scanner.fDir", "all"));
  const setFDir = (v) => { setFDirRaw(v); setPref("scanner.fDir", v); };
  const [fOut, setFOutRaw] = useState(() => pref("scanner.fOut", "all"));
  const setFOut = (v) => { setFOutRaw(v); setPref("scanner.fOut", v); };
  const [open, setOpen] = useState(null);
  const tone = (o) => (o === "target" ? "success" : o === "invalidated" ? "error" : "neutral");
  const lbl = (o) => (o === "target" ? "✓ target" : o === "invalidated" ? "✕ invalid" : "· open");
  const shown = rows.filter((h) =>
    (!fq || String(h.symbol || "").toUpperCase().includes(fq.toUpperCase()))
    && (fTier === "all" || h.tier === fTier)
    && (fDir === "all" || h.dir === fDir)
    && (fOut === "all" || (h.outcome || "open") === fOut));
  return (
    <Section>
      <VStack gap={2} padding={3} className="vg-dense">
        <HStack gap={2} align="center" justify="between" wrap="wrap">
          <Text type="label" color="secondary">
            History · {shown.length}{shown.length !== rows.length ? ` of ${rows.length}` : ""} — setups that aged past current
          </Text>
          <HStack gap={1} align="center" wrap="wrap">
            <input style={inputStyle} value={fq} placeholder="ticker…" aria-label="Filter by ticker"
              onChange={(e) => setFq(e.target.value)} />
            <select style={inputStyle} value={fTier} onChange={(e) => setFTier(e.target.value)} aria-label="Tier filter">
              <option value="all">tier: all</option><option value="A+">A+</option><option value="B">B</option>
            </select>
            <select style={inputStyle} value={fDir} onChange={(e) => setFDir(e.target.value)} aria-label="Side filter">
              <option value="all">side: all</option><option value="long">long</option><option value="short">short</option>
            </select>
            <select style={inputStyle} value={fOut} onChange={(e) => setFOut(e.target.value)} aria-label="Outcome filter">
              <option value="all">outcome: all</option><option value="open">open</option>
              <option value="target">target</option><option value="invalidated">invalidated</option>
            </select>
          </HStack>
        </HStack>
        <VStack gap={0}>
          {shown.map((h) => {
            const key = `${h.symbol}|${h.as_of}`;
            const expanded = open === key;
            return (
              <VStack key={key} gap={0}>
                <HStack gap={2} align="center" wrap="wrap" className="vg-click" role="button" tabIndex={0}
                  aria-expanded={expanded}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(expanded ? null : key); } }}
                  onClick={() => setOpen(expanded ? null : key)}>
                  <Link href={links.chart(h.symbol)}>{h.symbol}</Link>
                  <Badge variant={h.dir === "long" ? "success" : "error"} label={`${h.tier} ${h.dir === "long" ? "LONG" : "SHORT"}`} />
                  <Text type="supporting" color="secondary">
                    entry {zone(h)} · stop {h.invalid ?? "—"}
                    {Array.isArray(h.targets) && h.targets.length
                      ? ` · runner ${h.targets[h.targets.length - 1].price}` : ""}
                  </Text>
                  <Text type="supporting" color="secondary">{h.bars_ago}h ago</Text>
                  <Badge variant={tone(h.outcome)} label={lbl(h.outcome)} />
                </HStack>
                {expanded && (
                  <VStack gap={0} style={{ paddingLeft: 12, paddingBottom: 6 }}>
                    <Text type="supporting" color="secondary">
                      triggered {h.hour || hhmm(h.as_of)} · {h.ob_backed ? "OB-backed" : "no OB"} ·
                      {" "}{h.runner_is_pool ? "runner = liquidity pool" : "runner = fixed R"}
                      {h.note ? ` · ${h.note}` : ""}
                    </Text>
                    {(h.targets || []).map((t, i) => (
                      <Text key={i} type="supporting" color="secondary">
                        T{i + 1} · {t.r}R → {t.price}{t.size != null ? ` · ${Math.round(t.size * 100)}%` : ""}{t.note ? ` · ${t.note}` : ""}
                      </Text>
                    ))}
                  </VStack>
                )}
              </VStack>
            );
          })}
        </VStack>
      </VStack>
    </Section>
  );
}

export function ScannerPage() {
  const [scanner, setScannerRaw] = useState(() => pref("scanner.family", "ict_htf"));
  const setScanner = (v) => { setScannerRaw(v); setPref("scanner.family", v); };
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [watch, setWatch] = useState("");
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await getJson(`${backend()}/api/scanner?scanner=${encodeURIComponent(scanner)}`);
      setD(r && r.available !== false ? r : null);
      return r;
    } catch (e) { setD(null); return null; }
  }, [scanner]);

  useEffect(() => {
    let dead = false;
    setLoading(true); setD(null);
    load().finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; clearInterval(pollRef.current); };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await postJson(`${backend()}/api/scanner/refresh`, { scanner }); } catch (e) { /* logged server-side */ }
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await load();
      if (!r || String(r.status || "") !== "running") {
        clearInterval(pollRef.current); setRefreshing(false);
      }
    }, 5000);
  };

  const editWatch = async (body) => {
    try {
      const r = await postJson(`${backend()}/api/scanner/tickers`, body);
      setD((cur) => (cur ? { ...cur, manual_tickers: r.manual_tickers || [] } : cur));
    } catch (e) { /* non-fatal */ }
  };

  const hits = (d && d.hits) || [];
  const aplus = hits.filter((h) => h.tier === "A+" && !h.stale);
  const btier = hits.filter((h) => h.tier === "B" && !h.stale);
  const history = (d && d.history) || [];
  const manual = (d && d.manual_tickers) || [];
  const running = refreshing || String((d || {}).status || "") === "running";

  return (
    <Ledger
      band={
        <VStack gap={2}>
          <HStack gap={3} align="center" justify="between" wrap="wrap">
            <VStack gap={0}>
              <Heading level={1}>Scanner</Heading>
              <Text type="supporting" color="secondary">
                backtest-validated setups across the Nasdaq-100 + S&amp;P top-100 ·
                armed trades land in <Link href="#/performance">Performance</Link>
              </Text>
            </VStack>
            <HStack gap={2} align="center" wrap="wrap">
              <SegmentedControl value={scanner} onChange={setScanner} label="Strategy">
                {SCANNERS.map((s) => <SegmentedControlItem key={s.id} value={s.id} label={s.label} />)}
              </SegmentedControl>
              <Button label={running ? "Scanning…" : "Refresh scan"} variant="primary"
                isDisabled={running} onClick={refresh} />
            </HStack>
          </HStack>
          <HStack gap={2} align="center" wrap="wrap">
            {d && <Text type="supporting" color="secondary">
              covered {d.covered_n ?? "?"}/{d.universe_n ?? "?"} · {aplus.length} A+ · {btier.length} B
              {d.ran_at ? ` · last run ${hhmm(d.ran_at)}Z` : ""}
              {d.data_through ? ` · data through ${String(d.data_through).slice(0, 10)}` : ""}
            </Text>}
            {running && <Spinner size="sm" />}
            <HStack gap={1} align="center" wrap="wrap">
              <Text type="supporting" color="secondary">watch:</Text>
              {manual.map((t) => (
                <button key={t} onClick={() => editWatch({ remove: t })}
                  aria-label={`remove ${t} from the watch list`}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  <Badge variant="neutral" label={`${t} ✕`} />
                </button>
              ))}
              <input style={inputStyle} value={watch} placeholder="add ticker" aria-label="Add watch ticker"
                onChange={(e) => setWatch(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter" && watch.trim()) { editWatch({ add: watch.trim() }); setWatch(""); } }} />
            </HStack>
          </HStack>
        </VStack>
      }>
      {loading && <HStack gap={2} align="center"><Spinner size="sm" /><Text type="supporting" color="secondary">Loading the scan…</Text></HStack>}
      {!loading && !d && <Banner status="error" title="Scanner needs the SQLite backend" />}
      {d && aplus.length === 0 && btier.length === 0 && (
        <Text type="supporting" color="secondary">
          No CURRENT setups across {d.covered_n} covered tickers. History below shows how aged ones played out.
        </Text>
      )}
      {d && <TierGroup label="A+ setups" hits={aplus} />}
      {d && <TierGroup label="B setups" hits={btier} rationale="weaker context — not armed for paper" />}
      {history.length > 0 && <History rows={history} />}
    </Ledger>
  );
}
