"use client";
// Disease detail page. Server data, thin client rendering.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, DiseaseDetail, RelatedDisease, GraphNode, pct } from "@/lib/api";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold border-b border-slate-100 pb-1">{title}</h2>
      {children}
    </section>
  );
}

function Chips({ items, color = "bg-slate-100" }: { items: GraphNode[]; color?: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-400">None in demo data.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((n) => (
        <span key={n.id} className={`text-sm ${color} rounded px-2 py-1`} title={n.description}>
          {n.name} <span className="text-xs text-slate-500">{n.identifier}</span>
        </span>
      ))}
    </div>
  );
}

export default function DiseasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<DiseaseDetail | null>(null);
  const [related, setRelated] = useState<RelatedDisease[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.disease(id), api.related(id)])
      .then(([d, r]) => { setDetail(d); setRelated(r); })
      .catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!detail) return <p className="text-slate-500">Loading…</p>;
  const d = detail;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{d.disease.name}</h1>
        <p className="text-sm text-slate-500">{d.disease.identifier} · {d.disease.inheritance}</p>
        <p className="text-slate-700">{d.disease.description}</p>
        <div className="flex gap-3 pt-2">
          <Link href={`/graph/${id}`} className="text-sm bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700">Explore Knowledge Graph</Link>
          <Link href={`/opportunities/${id}`} className="text-sm border border-blue-600 text-blue-700 rounded px-3 py-1.5 hover:bg-blue-50">View Research Opportunities</Link>
        </div>
      </header>

      <Section title="Genes"><Chips items={d.genes} color="bg-blue-50" /></Section>
      <Section title="Variants"><Chips items={d.variants} color="bg-blue-50" /></Section>
      <Section title="Phenotypes"><Chips items={d.phenotypes} color="bg-amber-50" /></Section>
      <Section title="Mechanisms & pathways"><Chips items={[...d.mechanisms, ...d.pathways]} color="bg-purple-50" /></Section>

      <Section title="Related diseases">
        {related.length === 0 && <p className="text-sm text-slate-400">No supported connections in the demo graph.</p>}
        <div className="space-y-3">
          {related.map((r) => (
            <div key={r.disease.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-baseline justify-between flex-wrap gap-2">
                <Link href={`/disease/${r.disease.id}`} className="font-medium text-blue-700 hover:underline">{r.disease.name}</Link>
                <span className={`text-xs rounded px-2 py-0.5 ${r.connecting_edge.provenance === "inferred" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                  {r.connecting_edge.provenance === "inferred" ? "Atlas-inferred" : "Curated"} · p(valid) {pct(r.similarity)}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-1">{r.connecting_edge.description}</p>
              <p className="text-xs text-slate-500 mt-1">
                Shared phenotypes: {r.shared_phenotypes.map((p) => p.name).join(", ") || "none"} ·
                Shared pathways: {r.shared_pathways.map((p) => p.name).join(", ") || "none"} ·
                Genes: {r.genes.map((g) => g.name).join(", ")}
              </p>
              <Link href={`/connection/${id}/${r.disease.id}`} className="text-sm text-blue-700 hover:underline mt-1 inline-block">
                Why are these connected?
              </Link>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Research">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><h3 className="font-medium mb-1">Publications</h3><Chips items={d.publications} /></div>
          <div><h3 className="font-medium mb-1">Clinical studies</h3><Chips items={d.studies} color="bg-emerald-50" /></div>
          <div><h3 className="font-medium mb-1">Researchers</h3><Chips items={d.researchers} color="bg-cyan-50" /></div>
          <div><h3 className="font-medium mb-1">Patient organizations</h3><Chips items={d.organizations} color="bg-pink-50" /></div>
          <div><h3 className="font-medium mb-1">Research assets</h3><Chips items={d.assets} color="bg-lime-50" /></div>
        </div>
      </Section>
    </div>
  );
}
