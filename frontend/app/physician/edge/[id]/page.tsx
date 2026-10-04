"use client";
// Edge workbench: full decision block, leave-one-out evidence ablation
// ("which symptom carries the belief?"), and a what-if editor that re-judges
// the edited state live. The latter two require a live judge (ATLAS_JUDGE);
// the page degrades gracefully to read-only when judging is 501.
import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  v1, ApiError, EdgeDetail, AblateResponse, JudgeAnswers, pct, pct1, band,
} from "@/lib/v1";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function EdgeWorkbench({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<EdgeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { v1.edge(id).then(setDetail).catch((e) => setError(String(e))); }, [id]);

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!detail) return <p className="text-muted-foreground">Loading…</p>;

  const e = detail.edge;
  const b = band(e.edge_valid);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground font-mono">{e.id} · {e.source_db}</p>
        <h1 className="text-xl font-semibold flex items-center gap-3 flex-wrap">
          <Entity name={detail.source_node?.name ?? e.source} id={e.source} />
          <span className="text-sm font-normal text-muted-foreground">—{e.rel_type}→</span>
          <Entity name={detail.target_node?.name ?? e.target} id={e.target} />
        </h1>
        <p className="text-sm text-muted-foreground">{e.description}</p>
      </header>

      <section className="grid sm:grid-cols-4 gap-3">
        <Stat label="p(valid)" value={pct1(e.edge_valid)} extra={<span className={`text-[10px] rounded px-1.5 py-0.5 ${b.cls}`}>{b.label}</span>} />
        <Stat label="p(contradicted)" value={pct1(e.contradicted)} warn={(e.contradicted ?? 0) > 0.2} />
        <Stat label="evidence level" value={e.evidence_level ? e.evidence_level.expected.toFixed(2) : "–"} />
        <Stat label="judged by" value={e.decision_meta?.model ?? "–"} small />
      </section>

      {e.rel_probs && (
        <Distribution title="Relationship class" probs={e.rel_probs} />
      )}
      {e.evidence_level?.probs && (
        <Distribution title="Evidence ladder" probs={e.evidence_level.probs} />
      )}

      {e.state ? (
        <>
          <AblationPanel edgeId={e.id} />
          <WhatIfPanel initialState={e.state} storedValid={e.edge_valid} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground border-l-4 pl-3">
          Curated edge: no judged state. The shared source annotation is the proof;
          there is nothing to interrogate.
        </p>
      )}
    </div>
  );
}

function Entity({ name, id }: { name: string; id: string }) {
  return (
    <span>
      {name} <span className="text-xs font-normal text-muted-foreground font-mono">{id}</span>
    </span>
  );
}

function Stat({ label, value, extra, warn, small }: {
  label: string; value: string; extra?: React.ReactNode; warn?: boolean; small?: boolean;
}) {
  return (
    <div className={`border rounded-lg p-3 bg-background ${warn ? "border-foreground" : ""}`}>
      <p className={`${small ? "text-sm" : "text-xl"} font-semibold truncate`} title={value}>{value}</p>
      <p className="text-xs text-muted-foreground flex items-center gap-2">{label}{extra}</p>
    </div>
  );
}

function Distribution({ title, probs }: { title: string; probs: Record<string, number> }) {
  return (
    <section className="max-w-xl">
      <h2 className="text-sm font-semibold mb-1">{title}</h2>
      <div className="space-y-0.5 text-xs">
        {Object.entries(probs).map(([k, p]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-44 text-muted-foreground truncate">{k}</span>
            <div className="flex-1 h-3.5 bg-muted rounded overflow-hidden">
              <div className="h-full bg-foreground/70" style={{ width: `${p * 100}%` }} />
            </div>
            <span className="w-12 text-right font-mono text-muted-foreground">{pct1(p)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- ablation: 1 click → N live judgments → saliency bars ----

function AblationPanel({ edgeId }: { edgeId: string }) {
  const [res, setRes] = useState<AblateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = () => {
    setBusy(true); setErr(null);
    v1.ablate(edgeId).then(setRes)
      .catch((e) => setErr(e instanceof ApiError && e.status === 501
        ? "Live judge offline on this deployment: ablation unavailable."
        : e instanceof ApiError && e.status === 422
        ? "This edge's evidence has no ablatable list; use the what-if editor below."
        : String(e)))
      .finally(() => setBusy(false));
  };

  const maxAbs = useMemo(
    () => Math.max(0.01, ...(res?.items.map((i) => Math.abs(i.delta)) ?? [])),
    [res]);

  return (
    <Card className="py-4 max-w-2xl">
      <CardContent className="px-4">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="font-semibold text-sm">Why does the judge believe this?</h2>
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? "re-judging…" : res ? "re-run" : "run ablation"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Leave-one-out: the judge re-reads the evidence once per item with that item
          removed. Δ = how much p(valid) the item carries alone.
        </p>
        {err && <p className="text-xs font-medium">{err}</p>}
        {res && (
          <div className="space-y-1 text-xs">
            <p className="text-muted-foreground mb-2">
              baseline p(valid) <span className="font-mono">{pct1(res.baseline_valid)}</span>
              {" · "}{res.items.length + 1} judgments
            </p>
            {res.items.map((it) => (
              <div key={it.removed} className="flex items-center gap-2">
                <span className="w-56 truncate" title={it.removed}>{it.removed}</span>
                <div className="flex-1 h-4 relative bg-muted/50 rounded">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  {it.delta >= 0 ? (
                    <div className="absolute inset-y-0 left-1/2 bg-foreground/80 rounded-r"
                      style={{ width: `${(it.delta / maxAbs) * 50}%` }} />
                  ) : (
                    <div className="absolute inset-y-0 bg-muted-foreground/40 rounded-l"
                      style={{ right: "50%", width: `${(-it.delta / maxAbs) * 50}%` }} />
                  )}
                </div>
                <span className={`w-16 text-right font-mono ${it.delta > 0 ? "font-semibold" : "text-muted-foreground"}`}>
                  {it.delta >= 0 ? "+" : ""}{(it.delta * 100).toFixed(1)}pp
                </span>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground mt-2">
              Solid right = removing the item lowers belief (it carries evidence).
              Faded left = removing it raises belief.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---- what-if editor: edit state → debounced live re-judge ----

function WhatIfPanel({ initialState, storedValid }: { initialState: string; storedValid?: number | null }) {
  const [text, setText] = useState(initialState);
  const [answers, setAnswers] = useState<JudgeAnswers | null>(null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const judgeNow = (state: string) => {
    const mySeq = ++seq.current;
    setBusy(true); setErr(null);
    v1.judge(state).then((r) => {
      if (seq.current === mySeq) setAnswers(r.answers);
    }).catch((e) => {
      if (seq.current !== mySeq) return;
      if (e instanceof ApiError && e.status === 501) setOffline(true);
      else setErr(String(e));
    }).finally(() => { if (seq.current === mySeq) setBusy(false); });
  };

  // judge the original state once on mount (verifies parity with stored block)
  useEffect(() => { judgeNow(initialState); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initialState]);

  const onEdit = (val: string) => {
    setText(val);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => judgeNow(val), 400);
  };

  const live = answers?.edge_valid.noul;
  const contra = answers?.contradicted.noul;
  const delta = live != null && storedValid != null ? live - storedValid : null;

  if (offline) {
    return (
      <Card className="py-4 max-w-2xl">
        <CardContent className="px-4">
          <h2 className="font-semibold text-sm mb-1">What-if editor</h2>
          <p className="text-xs text-muted-foreground">
            Live judge offline on this deployment. Showing the stored evidence state read-only.
          </p>
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground mt-2">{initialState}</pre>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-4 max-w-2xl">
      <CardContent className="px-4">
        <h2 className="font-semibold text-sm mb-1">What-if editor</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Edit the evidence the judge reads. It re-judges ~400ms after you stop typing.
          Delete the gene line, weaken a phrase, add a contradiction: watch the
          probabilities move.
        </p>
        <textarea value={text} onChange={(e) => onEdit(e.target.value)} rows={7}
          className="w-full border border-input rounded-md p-2 text-xs font-mono bg-transparent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring" />
        <div className="flex items-center gap-6 mt-3 text-sm">
          <LiveDial label="p(valid)" value={live} busy={busy} />
          <LiveDial label="p(contradicted)" value={contra} busy={busy} />
          {delta != null && (
            <span className={`text-xs font-mono ${Math.abs(delta) < 0.02 ? "text-muted-foreground" : "font-semibold"}`}>
              {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}pp vs stored
            </span>
          )}
          {text !== initialState && (
            <Button variant="link" size="sm" className="ml-auto h-auto px-0 text-xs text-muted-foreground"
              onClick={() => { setText(initialState); judgeNow(initialState); }}>
              reset
            </Button>
          )}
        </div>
        {err && <p className="text-xs font-medium mt-2">{err}</p>}
      </CardContent>
    </Card>
  );
}

function LiveDial({ label, value, busy }: { label: string; value?: number; busy: boolean }) {
  return (
    <div>
      <p className={`text-2xl font-semibold font-mono transition-opacity ${busy ? "opacity-40" : ""}`}>
        {value == null ? "–" : pct1(value)}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
