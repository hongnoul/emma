"use client";
// Research opportunities + evidence-backed next steps.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, Opportunity } from "@/lib/api";

export default function OpportunitiesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.opportunities(id).then(setOpps).catch((e) => setError(String(e))); }, [id]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!opps) return <p className="text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Research Opportunities</h1>
        <p className="text-sm text-slate-500">
          Research opportunities requiring expert validation. These are not medical recommendations.
        </p>
      </header>

      {opps.length === 0 && (
        <p className="text-slate-500 text-sm">
          No opportunities derived from the current graph. This reflects missing evidence, not absence of possibility.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {opps.map((o) => (
          <div key={o.id} className="border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">{o.title}</h2>
              <span className="text-xs bg-slate-100 rounded px-1.5 py-0.5 shrink-0">{o.category}</span>
            </div>
            <div><h3 className="text-xs font-semibold text-slate-500 uppercase">What exists</h3><p>{o.what_exists}</p></div>
            <div><h3 className="text-xs font-semibold text-slate-500 uppercase">Why it may be relevant</h3><p>{o.why_relevant}</p></div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase">Evidence</h3>
              <p className="text-xs text-slate-500">Graph edges: {o.evidence_edge_ids.join(", ")}</p>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase">Requires validation</h3>
              <ul className="list-disc list-inside text-slate-600">
                {o.needs_validation.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            </div>
            <div className="border-t border-slate-100 pt-2">
              <h3 className="text-xs font-semibold text-blue-700 uppercase">Potential next step</h3>
              <p>{o.next_step}</p>
            </div>
            <p className="text-xs text-amber-700">{o.disclaimer}</p>
          </div>
        ))}
      </div>

      <Link href={`/disease/${id}`} className="text-sm text-blue-700 hover:underline">← Back to disease</Link>
    </div>
  );
}
