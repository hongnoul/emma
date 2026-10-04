"use client";
// Triage queue: keyboard-driven review of the review band (0.40–0.90, expert policy).
// j/k or ↓/↑ navigate · a accept · r reject · u undo · enter opens workbench.
// Verdicts persist to localStorage as a local gold set; the calibration
// panel recomputes reliability against your verdicts live.
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v1, V1Edge, pct, band } from "@/lib/v1";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Verdict = "accept" | "reject";
const STORE_KEY = "atlas-triage-verdicts-v1";

function loadVerdicts(): Record<string, Verdict> {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}"); } catch { return {}; }
}

export default function TriagePage() {
  // useSearchParams requires a Suspense boundary for static prerender.
  return <Suspense><TriageInner /></Suspense>;
}

function TriageInner() {
  const router = useRouter();
  const nodeFilter = useSearchParams().get("node");
  const [edges, setEdges] = useState<V1Edge[] | null>(null);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [history, setHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lo, setLo] = useState(0.4);
  const [hi, setHi] = useState(0.9);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setVerdicts(loadVerdicts()); }, []);

  useEffect(() => {
    setEdges(null);
    v1.edges({ judged_only: true, min_valid: lo, max_valid: hi, limit: 200,
               node: nodeFilter ?? undefined })
      .then((r) => { setEdges(r.items); setTotal(r.total); setCursor(0); })
      .catch((e) => setError(String(e)));
  }, [lo, hi, nodeFilter]);

  const saveVerdict = useCallback((edgeId: string, v: Verdict) => {
    setVerdicts((prev) => {
      const next = { ...prev, [edgeId]: v };
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
      return next;
    });
    setHistory((h) => [...h, edgeId]);
    setCursor((c) => Math.min(c + 1, (edges?.length ?? 1) - 1));
  }, [edges]);

  const undo = useCallback(() => {
    setHistory((h) => {
      const last = h[h.length - 1];
      if (!last) return h;
      setVerdicts((prev) => {
        const next = { ...prev };
        delete next[last];
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
        return next;
      });
      return h.slice(0, -1);
    });
    setCursor((c) => Math.max(0, c - 1));
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!edges?.length) return;
      if ((ev.target as HTMLElement)?.tagName === "INPUT") return;
      const cur = edges[cursor];
      switch (ev.key) {
        case "j": case "ArrowDown": setCursor((c) => Math.min(c + 1, edges.length - 1)); ev.preventDefault(); break;
        case "k": case "ArrowUp": setCursor((c) => Math.max(0, c - 1)); ev.preventDefault(); break;
        case "a": if (cur) saveVerdict(cur.id, "accept"); break;
        case "r": if (cur) saveVerdict(cur.id, "reject"); break;
        case "u": undo(); break;
        case "Enter": if (cur) router.push(`/physician/edge/${encodeURIComponent(cur.id)}`); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [edges, cursor, saveVerdict, undo, router]);

  // keep cursor row in view
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // live calibration against local verdicts
  const calib = useMemo(() => {
    if (!edges) return null;
    const labeled = edges.filter((e) => verdicts[e.id] && e.edge_valid != null);
    if (labeled.length === 0) return { n: 0, bins: [], brier: null as number | null };
    let brierSum = 0;
    const bins = [0, 1, 2, 3, 4].map((i) => ({ lo: 0.4 + i * 0.1, hi: 0.4 + (i + 1) * 0.1, preds: [] as number[], trues: [] as number[] }));
    for (const e of labeled) {
      const p = e.edge_valid!;
      const y = verdicts[e.id] === "accept" ? 1 : 0;
      brierSum += (p - y) ** 2;
      const b = bins.find((b) => p >= b.lo && p < b.hi) ?? bins[bins.length - 1];
      b.preds.push(p); b.trues.push(y);
    }
    return {
      n: labeled.length,
      brier: brierSum / labeled.length,
      bins: bins.filter((b) => b.preds.length > 0).map((b) => ({
        range: [b.lo, b.hi],
        count: b.preds.length,
        meanPred: b.preds.reduce((s, x) => s + x, 0) / b.preds.length,
        fracTrue: b.trues.reduce((s, x) => s + x, 0) / b.trues.length,
      })),
    };
  }, [edges, verdicts]);

  const reviewed = Object.keys(verdicts).length;

  if (error) return <p className="text-sm font-medium">{error}</p>;

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-3 min-w-0">
        <header className="flex items-end gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Triage queue</h1>
            <p className="text-xs text-muted-foreground">
              {total.toLocaleString()} judged edges in band · showing {edges?.length ?? 0} ·{" "}
              <kbd className="border rounded px-1 bg-background">j</kbd>/<kbd className="border rounded px-1 bg-background">k</kbd> move ·{" "}
              <kbd className="border rounded px-1 bg-background">a</kbd> accept ·{" "}
              <kbd className="border rounded px-1 bg-background">r</kbd> reject ·{" "}
              <kbd className="border rounded px-1 bg-background">u</kbd> undo ·{" "}
              <kbd className="border rounded px-1 bg-background">⏎</kbd> workbench
            </p>
          </div>
          <label className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
            band
            <Input type="number" min={0} max={1} step={0.05} value={lo}
              onChange={(e) => setLo(Number(e.target.value))}
              className="w-16 h-7 px-1" />
            –
            <Input type="number" min={0} max={1} step={0.05} value={hi}
              onChange={(e) => setHi(Number(e.target.value))}
              className="w-16 h-7 px-1" />
          </label>
        </header>

        {!edges && <p className="text-muted-foreground">Loading…</p>}

        <div ref={listRef} className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
          {edges?.map((e, i) => {
            const v = verdicts[e.id];
            const active = i === cursor;
            return (
              <button key={e.id} onClick={() => setCursor(i)}
                onDoubleClick={() => router.push(`/physician/edge/${encodeURIComponent(e.id)}`)}
                className={`w-full text-left border rounded-lg px-3 py-2 bg-background flex items-center gap-3 text-sm transition
                  ${active ? "border-foreground ring-2 ring-ring/30" : ""}
                  ${v === "accept" ? "opacity-60 border-l-4 border-l-foreground" : ""}
                  ${v === "reject" ? "opacity-60 border-l-4 border-l-muted-foreground border-dashed" : ""}`}>
                <span className={`shrink-0 font-mono text-xs rounded px-1.5 py-0.5 ${band(e.edge_valid).cls}`}>
                  {pct(e.edge_valid)}
                </span>
                <span className="truncate flex-1">{e.description}</span>
                {e.contradicted != null && e.contradicted > 0.2 && (
                  <span className="shrink-0 text-xs font-medium" title={`p(contradicted) ${pct(e.contradicted)}`}>⚠ {pct(e.contradicted)}</span>
                )}
                {v && <span className="shrink-0 text-xs text-muted-foreground">{v === "accept" ? "✓" : "✗"}</span>}
              </button>
            );
          })}
          {edges?.length === 0 && <p className="text-muted-foreground text-sm">No judged edges in this band.</p>}
        </div>
      </div>

      <aside className="space-y-4">
        <Card className="py-4">
          <CardContent className="px-4">
            <h2 className="font-semibold text-sm mb-2">Your gold set</h2>
            <p className="text-3xl font-semibold">{reviewed}</p>
            <p className="text-xs text-muted-foreground">verdicts recorded (stored locally)</p>
            {reviewed > 0 && (
              <Button variant="link" size="sm" className="px-0 h-auto mt-2 text-xs text-muted-foreground"
                onClick={() => { localStorage.removeItem(STORE_KEY); setVerdicts({}); setHistory([]); }}>
                clear
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="py-4">
          <CardContent className="px-4">
            <h2 className="font-semibold text-sm mb-1">Live calibration</h2>
            <p className="text-xs text-muted-foreground mb-3">
              model p(valid) vs your verdicts, this band only
            </p>
            {!calib || calib.n === 0 ? (
              <p className="text-xs text-muted-foreground">Record verdicts to see reliability.</p>
            ) : (
              <>
                <p className="text-xs mb-2">
                  n={calib.n} · Brier <span className="font-mono">{calib.brier!.toFixed(3)}</span>
                </p>
                <div className="space-y-1 text-[10px]">
                  {calib.bins.map((b, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="w-16 text-muted-foreground font-mono">{b.range[0].toFixed(2)}–{b.range[1].toFixed(2)}</span>
                      <div className="flex-1 h-4 bg-muted rounded relative">
                        <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${b.meanPred * 100}%` }} title={`mean predicted ${b.meanPred.toFixed(2)}`} />
                        <div className="absolute inset-y-0 w-[3px] bg-muted-foreground/60" style={{ left: `${b.fracTrue * 100}%` }} title={`your accept rate ${b.fracTrue.toFixed(2)}`} />
                      </div>
                      <span className="w-6 text-right text-muted-foreground">{b.count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  <span className="font-medium text-foreground">thin black</span> predicted · <span className="font-medium">thick gray</span> your accept rate.
                  Gray left of black = model overconfident in this band.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {edges && edges[cursor] && <CurrentEdgeCard edge={edges[cursor]} />}
      </aside>
    </div>
  );
}

function CurrentEdgeCard({ edge }: { edge: V1Edge }) {
  return (
    <Card className="py-4 border-foreground/30">
      <CardContent className="px-4 text-xs space-y-2">
        <h2 className="font-semibold text-sm">Selected edge</h2>
        <p className="text-muted-foreground">{edge.description}</p>
        <dl className="grid grid-cols-2 gap-1">
          <dt className="text-muted-foreground">p(valid)</dt><dd className="font-mono">{pct(edge.edge_valid)}</dd>
          <dt className="text-muted-foreground">p(contradicted)</dt><dd className="font-mono">{pct(edge.contradicted)}</dd>
          <dt className="text-muted-foreground">judge</dt><dd className="font-mono truncate">{edge.decision_meta?.model ?? "–"}</dd>
        </dl>
        {edge.state && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">evidence state</summary>
            <pre className="whitespace-pre-wrap text-[10px] text-muted-foreground mt-1 max-h-40 overflow-y-auto">{edge.state}</pre>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
