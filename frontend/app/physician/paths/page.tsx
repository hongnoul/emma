"use client";
// Path inspector: how are two diseases connected? Every hop shows its
// probability, the joint path confidence is the product over judged hops,
// and the weakest judged hop is highlighted with a one-click link into the
// edge workbench to interrogate it.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { v1, EntityHit, PathResponse, pct, band, actionCls } from "@/lib/v1";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function PathsPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <PathsInner />
    </Suspense>
  );
}

function PathsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const audience = sp.get("audience") ?? "researcher";
  const [res, setRes] = useState<PathResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!from || !to) { setRes(null); return; }
    setBusy(true); setError(null);
    v1.paths(from, to, audience).then(setRes).catch((e) => setError(String(e))).finally(() => setBusy(false));
  }, [from, to, audience]);

  const setParam = (key: "from" | "to" | "audience", id: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set(key, id);
    router.replace(`/physician/paths?${next.toString()}`);
  };

  // server trust block (falls back to client math when the backend is old)
  const trust = res?.trust;
  const joint = trust?.p_path ?? null;
  const weakestGate = trust && trust.weakest_link != null ? trust.edges[trust.weakest_link] : null;
  const judgedHops = res?.path.filter((s) => s.edge?.edge_valid != null) ?? [];
  const weakest = weakestGate
    ? (judgedHops.find((s) => s.edge?.id === weakestGate.edge_id) ?? null)
    : (judgedHops.length
      ? judgedHops.reduce((min, s) => (s.edge!.edge_valid! < min.edge!.edge_valid! ? s : min))
      : null);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Path inspector</h1>
        <p className="text-xs text-muted-foreground">
          Pick two diseases. Joint confidence = product of judged hop probabilities;
          the weakest hop is where the inference chain is most fragile.
        </p>
      </header>

      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
        <EntityPicker label="From" value={from} onPick={(id) => setParam("from", id)} />
        <EntityPicker label="To" value={to} onPick={(id) => setParam("to", id)} />
      </div>
      <div className="flex gap-2">
        {(["researcher", "patient"] as const).map((a) => (
          <Button key={a} size="sm" variant={audience === a ? "default" : "outline"}
            onClick={() => setParam("audience", a)}>
            {a === "researcher" ? "Researcher view" : "Patient view (≥0.90 + replicated)"}
          </Button>
        ))}
      </div>

      {busy && <p className="text-muted-foreground text-sm">Finding route…</p>}
      {error && <p className="text-sm font-medium">{error}</p>}

      {res && (
        <>
          {res.path.length === 0 ? (
            <p className="text-muted-foreground text-sm">No supported route found in the current graph.</p>
          ) : (
            <>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <p className="text-2xl font-semibold font-mono">
                    {joint != null ? pct(joint) : judgedHops.length ? pct(judgedHops.reduce((p, s) => p * (s.edge!.edge_valid as number), 1)) : "curated"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {trust ? `p_path (server, ${trust.edges.length} evidence edges, audience: ${trust.audience})`
                      : judgedHops.length
                      ? `joint confidence (${judgedHops.length} judged hop${judgedHops.length === 1 ? "" : "s"})`
                      : "every hop is a curated annotation, no judged inference in this route"}
                  </p>
                </div>
                {weakest && (
                  <div className="border border-foreground/40 bg-muted/50 rounded-lg px-4 py-2">
                    <p className="text-xs">
                      weakest hop: <span className="font-mono font-semibold">{pct(weakest.edge!.edge_valid)}</span>{" "}
                      — {weakest.edge!.description}
                    </p>
                    <Link href={`/physician/edge/${encodeURIComponent(weakest.edge!.id)}`}
                      className="text-xs underline underline-offset-4 hover:no-underline">
                      interrogate in workbench →
                    </Link>
                  </div>
                )}
              </div>

              {/* hop chain */}
              <div className="space-y-0">
                {res.path.map((step, i) => (
                  <div key={step.node.id}>
                    {i > 0 && step.edge && (
                      <HopEdge edge={step.edge} weak={step === weakest}
                        gate={trust?.edges.find((g) => g.edge_id === step.edge!.id)} />
                    )}
                    <div className={`inline-block rounded px-3 py-1.5 text-sm ${step.node.type === "Disease" ? "border font-medium bg-background" : "bg-muted"}`}>
                      {step.node.name}
                      <span className="text-xs text-muted-foreground font-mono ml-2">{step.node.id}</span>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-sm border-l-4 pl-4 max-w-2xl">{res.narrative}</p>

              <div className="grid sm:grid-cols-3 gap-4 text-xs max-w-4xl">
                <Bucket title="Known" items={res.known} />
                <Bucket title="Inferred" items={res.inferred} />
                <Bucket title="Uncertain" items={res.uncertain} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function HopEdge({ edge, weak, gate }: {
  edge: import("@/lib/v1").V1Edge;
  weak: boolean;
  gate?: import("@/lib/v1").TrustEdgeGate;
}) {
  const b = band(edge.edge_valid);
  return (
    <div className={`ml-6 my-1 pl-4 border-l-2 ${weak ? "border-foreground" : ""} text-xs py-1`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground">{edge.rel_type}</span>
        {edge.edge_valid != null ? (
          <>
            <span className={`font-mono rounded px-1.5 py-0.5 ${b.cls}`}>{pct(edge.edge_valid)} {b.label}</span>
            {gate && (
              <span className={`rounded px-1.5 py-0.5 ${actionCls(gate.action)}`} title={gate.reason}>
                {gate.action.replace(/_/g, " ")}
              </span>
            )}
            <Link href={`/physician/edge/${encodeURIComponent(edge.id)}`} className="underline underline-offset-4 hover:no-underline">
              workbench
            </Link>
          </>
        ) : (
          <span className="text-muted-foreground">curated</span>
        )}
        {weak && <span className="font-semibold">← weakest link</span>}
      </div>
      {gate?.caveat && (gate.action === "show_hypothesis" || gate.action === "show_with_warning") && (
        <p className="text-muted-foreground mt-0.5">{gate.caveat}</p>
      )}
    </div>
  );
}

function Bucket({ title, items }: { title: string; items: string[] }) {
  return (
    <Card className="py-3 gap-1">
      <CardHeader className="px-3"><CardTitle className="text-xs">{title}</CardTitle></CardHeader>
      <CardContent className="px-3">
        {items.length ? <ul className="space-y-1">{items.map((k, i) => <li key={i}>{k}</li>)}</ul>
          : <p className="text-muted-foreground">—</p>}
      </CardContent>
    </Card>
  );
}

// ---- typeahead over /v1/entities ----

function EntityPicker({ label, value, onPick }: { label: string; value: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<EntityHit[]>([]);
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<string>("");

  // show the chosen entity's name
  useEffect(() => {
    if (!value) { setResolved(""); return; }
    v1.entity(value).then((d) => setResolved(d.node.name)).catch(() => setResolved(value));
  }, [value]);

  useEffect(() => {
    if (q.length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      v1.entities(q, "Disease", 8).then((r) => { setHits(r.items); setOpen(true); }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input value={q} onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={resolved || "search a disease…"} />
      {value && !q && (
        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{value}</p>
      )}
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-popover text-popover-foreground border rounded-lg shadow-lg max-h-64 overflow-y-auto text-sm">
          {hits.map((h) => (
            <li key={h.node.id}>
              <button className="w-full text-left px-3 py-2 hover:bg-muted"
                onMouseDown={() => { onPick(h.node.id); setQ(""); setOpen(false); }}>
                {h.node.name}
                <span className="text-xs text-muted-foreground font-mono ml-2">{h.node.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
