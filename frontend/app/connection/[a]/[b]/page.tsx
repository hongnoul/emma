"use client";
// "Why are these connected?" page. Trust layer: server p_path with
// weakest-link, audience toggle (researcher vs patient gate), per-edge gate
// chips with expert caveat language, zombie edges struck through.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, ConnectionExplanation, pct } from "@/lib/api";
import { v1, TrustBlock, actionCls, band } from "@/lib/v1";

export default function ConnectionPage({ params }: { params: Promise<{ a: string; b: string }> }) {
  const { a, b } = use(params);
  const [c, setC] = useState<ConnectionExplanation | null>(null);
  const [trust, setTrust] = useState<TrustBlock | null>(null);
  const [audience, setAudience] = useState<"researcher" | "patient">("researcher");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.connection(a, b).then(setC).catch((e) => setError(String(e))); }, [a, b]);
  useEffect(() => {
    v1.paths(a, b, audience).then((r) => setTrust(r.trust ?? null)).catch(() => setTrust(null));
  }, [a, b, audience]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!c) return <p className="text-slate-500">Loading…</p>;

  const gateFor = (edgeId: string) => trust?.edges.find((g) => g.edge_id === edgeId);
  const isZombie = (edgeId: string) => {
    const g = gateFor(edgeId);
    return g?.band === "hidden" || g?.action === "hidden";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Why are these connected?</h1>

      <div className="flex gap-2 text-xs">
        {(["researcher", "patient"] as const).map((x) => (
          <button key={x} onClick={() => setAudience(x)}
            className={`rounded px-3 py-1 border ${audience === x ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-600"}`}>
            {x === "researcher" ? "Researcher view" : "Patient view"}
          </button>
        ))}
        {trust?.p_path != null && (
          <span className="ml-2 text-sm text-slate-600">
            path confidence <span className="font-mono font-semibold">{pct(trust.p_path)}</span>
            {trust.weakest_p != null && <span className="text-slate-400"> (weakest hop {pct(trust.weakest_p)})</span>}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-sm">
        {c.path.map((step, i) => (
          <span key={step.node.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-400" title={step.edge?.rel_type}>—{step.edge?.rel_type}→</span>}
            <span className={`rounded px-2 py-1 ${step.node.type === "Disease" ? "bg-red-50 font-medium" : "bg-slate-100"}`}>
              {step.node.name}
            </span>
          </span>
        ))}
        {c.path.length === 0 && <span className="text-slate-500">No supported route found in the current graph.</span>}
      </div>

      <p className="text-slate-700 border-l-4 border-blue-200 pl-4">{c.narrative}</p>

      <div className="grid sm:grid-cols-3 gap-4 text-sm">
        <div className="border border-green-200 rounded-lg p-3 bg-green-50/40">
          <h2 className="font-semibold text-green-800 mb-2">What is known</h2>
          {c.known.length ? <ul className="space-y-1">{c.known.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-slate-400">—</p>}
        </div>
        <div className="border border-amber-200 rounded-lg p-3 bg-amber-50/40">
          <h2 className="font-semibold text-amber-800 mb-2">What is inferred</h2>
          {c.inferred.length ? <ul className="space-y-1">{c.inferred.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-slate-400">—</p>}
        </div>
        <div className="border border-red-200 rounded-lg p-3 bg-red-50/40">
          <h2 className="font-semibold text-red-800 mb-2">What remains uncertain</h2>
          {c.uncertain.length ? <ul className="space-y-1">{c.uncertain.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-slate-400">—</p>}
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-2">Evidence table</h2>
        <table className="w-full text-sm border border-slate-200">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-2">Relationship</th><th className="p-2">Provenance</th>
              <th className="p-2">Source</th><th className="p-2">p(valid)</th>
              <th className="p-2">p(contradicted)</th><th className="p-2">Publications</th>
            </tr>
          </thead>
          <tbody>
            {c.evidence_edges.map((e) => {
              const g = gateFor(e.id);
              const zombie = isZombie(e.id);
              const b = band(e.edge_valid);
              return (
              <tr key={e.id} className={`border-t border-slate-100 align-top ${zombie ? "bg-red-50/40" : ""}`}>
                <td className={`p-2 ${zombie ? "line-through text-slate-400" : ""}`}>{e.rel_type}
                  <p className="text-xs text-slate-500">{e.description}</p>
                  {zombie && <p className="text-xs text-red-700 no-underline">superseded — struck through, do not act on this</p>}
                  {g && <p><span className={`text-xs rounded px-1.5 py-0.5 ${actionCls(g.action)}`} title={g.reason}>{g.action.replace(/_/g, " ")}</span></p>}
                </td>
                <td className="p-2">
                  <span className={`text-xs rounded px-1.5 py-0.5 ${e.provenance === "inferred" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                    {e.provenance}
                  </span>
                </td>
                <td className="p-2 text-xs">{e.source_db}</td>
                <td className="p-2"><span className={`text-xs rounded px-1.5 py-0.5 ${b.cls}`}>{pct(e.edge_valid)} {b.label}</span></td>
                <td className="p-2">{pct(e.contradicted)}</td>
                <td className="p-2 text-xs">
                  {e.supporting_publications.join(", ") || "—"}
                  {e.contradictory_evidence.length > 0 && <p className="text-red-700">contradicted by {e.contradictory_evidence.join(", ")}</p>}
                  {g?.caveat && g.action !== "show" && <p className="text-slate-500 mt-1">{g.caveat}</p>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="flex gap-4 text-sm">
        <Link href={`/disease/${a}`} className="text-blue-700 hover:underline">← {c.source.name}</Link>
        <Link href={`/opportunities/${a}`} className="text-blue-700 hover:underline">Research opportunities →</Link>
      </div>
    </div>
  );
}
