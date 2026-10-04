"use client";
// Disease detail page. Server data, thin client rendering.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, DiseaseDetail, RelatedDisease, GraphNode, pct } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold border-b pb-1">{title}</h2>
      {children}
    </section>
  );
}

function Chips({ items }: { items: GraphNode[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None in current dataset.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((n) => (
        <Badge key={n.id} variant="secondary" className="font-normal" title={n.description}>
          {n.name} <span className="text-xs text-muted-foreground">{n.identifier}</span>
        </Badge>
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

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!detail) return <p className="text-muted-foreground">Loading…</p>;
  const d = detail;

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{d.disease.name}</h1>
        <p className="text-sm text-muted-foreground">{d.disease.identifier} · {d.disease.inheritance}</p>
        <p>{d.disease.description}</p>
        <div className="flex gap-3 pt-2">
          <Button asChild size="sm"><Link href={`/graph/${id}`}>Explore Knowledge Graph</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href={`/opportunities/${id}`}>View Research Opportunities</Link></Button>
        </div>
      </header>

      <Section title="Genes"><Chips items={d.genes} /></Section>
      <Section title="Variants"><Chips items={d.variants} /></Section>
      <Section title="Phenotypes"><Chips items={d.phenotypes} /></Section>
      <Section title="Mechanisms & pathways"><Chips items={[...d.mechanisms, ...d.pathways]} /></Section>

      <Section title="Related diseases">
        {related.length === 0 && <p className="text-sm text-muted-foreground">No supported connections in the demo graph.</p>}
        <div className="space-y-3">
          {related.map((r) => (
            <Card key={r.disease.id} className="py-4">
              <CardContent className="px-4">
                <div className="flex items-baseline justify-between flex-wrap gap-2">
                  <Link href={`/disease/${r.disease.id}`} className="font-medium underline underline-offset-4 hover:no-underline">{r.disease.name}</Link>
                  <Badge variant={r.connecting_edge.provenance === "inferred" ? "outline" : "default"}>
                    {r.connecting_edge.provenance === "inferred" ? "Atlas-inferred" : "Curated"} · p(valid) {pct(r.similarity)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">{r.connecting_edge.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Shared phenotypes: {r.shared_phenotypes.map((p) => p.name).join(", ") || "none"} ·
                  Shared pathways: {r.shared_pathways.map((p) => p.name).join(", ") || "none"} ·
                  Genes: {r.genes.map((g) => g.name).join(", ")}
                </p>
                <Link href={`/connection/${id}/${r.disease.id}`} className="text-sm underline underline-offset-4 hover:no-underline mt-1 inline-block">
                  Why are these connected?
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Research">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div><h3 className="font-medium mb-1">Publications</h3><Chips items={d.publications} /></div>
          <div><h3 className="font-medium mb-1">Clinical studies</h3><Chips items={d.studies} /></div>
          <div><h3 className="font-medium mb-1">Researchers</h3><Chips items={d.researchers} /></div>
          <div><h3 className="font-medium mb-1">Patient organizations</h3><Chips items={d.organizations} /></div>
          <div><h3 className="font-medium mb-1">Research assets</h3><Chips items={d.assets} /></div>
        </div>
      </Section>
    </div>
  );
}
