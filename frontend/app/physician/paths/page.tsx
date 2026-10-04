"use client";
// Path inspector: how are two diseases connected? Every hop shows its
// probability, the joint path confidence is the product over judged hops,
// and the weakest judged hop is highlighted with a one-click link into the
// edge workbench to interrogate it.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { v1, EntityHit, PathResponse, pct, band, actionCls } from "@/lib/v1";

export default function PathsPage() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
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
        <p className="text-xs text-slate-500">
          Pick two diseases. Joint confidence = product of judged hop probabilities;
          the weakest hop is where the inference chain is most fragile.
        </p>
      </header>

      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
        <EntityPicker label="From" value={from} onPick={(id) => setParam("from", id)} />
        <EntityPicker label="To" value={to} onPick={(id) => setParam("to", id)} />
      </div>
      <div className="flex gap-2 text-xs">
        {(["researcher", "patient"] as const).map((a) => (
          <button key={a} onClick={() => setParam("audience", a)}
            className={`rounded px-3 py-1 border ${audience === a ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600"}`}>
            {a === "researcher" ? "Researcher view" : "Patient view (≥0.90 + replicated)"}
          </button>
        ))}
      </div>

      {busy && <p className="text-slate-500 text-sm">Finding route…</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {res && (
        <>
          {res.path.length === 0 ? (
            <p className="text-slate-500 text-sm">No supported route found in the current graph.</p>
          ) : (
            <>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <p className="text-2xl font-semibold font-mono">
                    {joint != null ? pct(joint) : judgedHops.length ? pct(judgedHops.reduce((p, s) => p * (s.edge!.edge_valid as number), 1)) : "curated"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {trust ? `p_path (server, ${trust.edges.length} evidence edges, audience: ${trust.audience})`
                      : judgedHops.length
                      ? `joint confidence (${judgedHops.length} judged hop${judgedHops.length === 1 ? "" : "s"})`
                      : "every hop is a curated annotation, no judged inference in this route"}
                  </p>
                </div>
                {weakest && (
                  <div className="border border-red-200 bg-red-50/50 rounded-lg px-4 py-2">
                    <p className="text-xs text-red-800">
                      weakest hop: <span className="font-mono">{pct(weakest.edge!.edge_valid)}</span>{" "}
                      — {weakest.edge!.description}
                    </p>
                    <Link href={`/physician/edge/${encodeURIComponent(weakest.edge!.id)}`}
                      className="text-xs text-indigo-700 underline">
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
                    <div className={`inline-block rounded px-3 py-1.5 text-sm ${step.node.type === "Disease" ? "bg-red-50 border border-red-100 font-medium" : "bg-slate-100"}`}>
                      {step.node.name}
                      <span className="text-xs text-slate-400 font-mono ml-2">{step.node.id}</span>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-sm text-slate-700 border-l-4 border-indigo-200 pl-4 max-w-2xl">{res.narrative}</p>

              <div className="grid sm:grid-cols-3 gap-4 text-xs max-w-4xl">
                <Bucket title="Known" items={res.known} cls="border-green-200 bg-green-50/40 text-green-800" />
                <Bucket title="Inferred" items={res.inferred} cls="border-amber-200 bg-amber-50/40 text-amber-800" />
                <Bucket title="Uncertain" items={res.uncertain} cls="border-red-200 bg-red-50/40 text-red-800" />
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
    <div className={`ml-6 my-1 pl-4 border-l-2 ${weak ? "border-red-400" : "border-slate-200"} text-xs py-1`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-400">{edge.rel_type}</span>
        {edge.edge_valid != null ? (
          <>
            <span className={`font-mono rounded px-1.5 py-0.5 ${b.cls}`}>{pct(edge.edge_valid)} {b.label}</span>
            {gate && (
              <span className={`rounded px-1.5 py-0.5 ${actionCls(gate.action)}`} title={gate.reason}>
                {gate.action.replace(/_/g, " ")}
              </span>
            )}
            <Link href={`/physician/edge/${encodeURIComponent(edge.id)}`} className="text-indigo-600 underline">
              workbench
            </Link>
          </>
        ) : (
          <span className="text-slate-400">curated</span>
        )}
        {weak && <span className="text-red-600 font-medium">← weakest link</span>}
      </div>
      {gate?.caveat && (gate.action === "show_hypothesis" || gate.action === "show_with_warning") && (
        <p className="text-slate-500 mt-0.5">{gate.caveat}</p>
      )}
    </div>
  );
}

function Bucket({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  return (
    <div className={`border rounded-lg p-3 ${cls}`}>
      <h2 className="font-semibold mb-1">{title}</h2>
      {items.length ? <ul className="space-y-1 text-slate-700">{items.map((k, i) => <li key={i}>{k}</li>)}</ul>
        : <p className="text-slate-400">—</p>}
    </div>
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
      <label className="text-xs text-slate-500">{label}</label>
      <input value={q} onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={resolved || "search a disease…"}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white" />
      {value && !q && (
        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{value}</p>
      )}
      {open && hits.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto text-sm">
          {hits.map((h) => (
            <li key={h.node.id}>
              <button className="w-full text-left px-3 py-2 hover:bg-indigo-50"
                onMouseDown={() => { onPick(h.node.id); setQ(""); setOpen(false); }}>
                {h.node.name}
                <span className="text-xs text-slate-400 font-mono ml-2">{h.node.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
