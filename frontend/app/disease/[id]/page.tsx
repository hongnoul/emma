"use client";
// Disease detail page. Layout ported from the Rare Disease Atlas prototype
// (TanStack Start zip): editorial header with action buttons, bordered
// sections with mono sub-labels, genes table with evidence status, phenotype
// chip cloud, two-column research grids. Data stays on the repo FastAPI via
// lib/api.ts; provenance is encoded with weight/fill per the monochrome
// system (solid = curated, outline = inferred).
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, DiseaseDetail, RelatedDisease, GraphNode, GraphEdge, pct } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t pt-6">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-2xl font-semibold">{title}</h2>
        {sub && <span className="font-mono text-xs text-muted-foreground">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function Chips({ items }: { items: GraphNode[] }) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">None in current dataset.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((n) => (
        <span
          key={n.id}
          title={n.description}
          className="rounded-sm border bg-card px-2 py-0.5 text-xs"
        >
          {n.name}
          {n.identifier && (
            <span className="ml-1 text-muted-foreground">· {n.identifier}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function DiseasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<DiseaseDetail | null>(null);
  const [related, setRelated] = useState<RelatedDisease[]>([]);
  const [evidence, setEvidence] = useState<GraphEdge[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.disease(id), api.related(id), api.evidence(id)])
      .then(([d, r, e]) => { setDetail(d); setRelated(r); setEvidence(e); })
      .catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!detail)
    return (
      <div className="py-8">
        <p className="font-mono text-sm text-muted-foreground">
          Gathering evidence for {id}…
        </p>
      </div>
    );
  const d = detail;
  const geneEdges = evidence.filter(
    (e) => d.genes.some((g) => g.id === e.source || g.id === e.target),
  );

  return (
    <div className="mx-auto max-w-6xl py-2">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-3xl">
          <p className="font-mono text-xs text-muted-foreground">
            {d.disease.identifier ?? d.disease.id}
            {d.disease.inheritance && ` · ${d.disease.inheritance}`}
          </p>
          <h1 className="mt-1 text-4xl font-semibold">{d.disease.name}</h1>
          {d.disease.description && (
            <p className="mt-3 text-muted-foreground">{d.disease.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/opportunities/${id}`}>Research opportunities</Link>
          </Button>
          <Button asChild>
            <Link href={`/graph/${id}`}>Open knowledge graph →</Link>
          </Button>
        </div>
      </div>

      <div className="mt-10 space-y-10">
        {/* What causes it: genes table with evidence status */}
        <Section
          title="What causes it"
          sub={`${d.genes.length} genes · ${geneEdges.length} evidence edges`}
        >
          {d.genes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No gene associations reported.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="font-mono text-[11px] uppercase">
                    <TableHead>Gene</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Relation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.genes.slice(0, 15).map((g) => {
                    const e = geneEdges.find(
                      (x) => x.source === g.id || x.target === g.id,
                    );
                    return (
                      <TableRow key={g.id}>
                        <TableCell className="font-mono font-medium">{g.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {g.description || "—"}
                        </TableCell>
                        <TableCell>
                          {e ? e.rel_type.replace(/_/g, " ").toLowerCase() : "associated"}
                        </TableCell>
                        <TableCell>
                          {e && (
                            <Badge variant={e.provenance === "inferred" ? "outline" : "default"}>
                              {e.provenance}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e?.source_db ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        {/* Variants */}
        <Section title="Pathogenic variants" sub={`${d.variants.length} in dataset`}>
          {d.variants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pathogenic variants retrieved.</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {d.variants.map((v) => (
                <li key={v.id} className="rounded border bg-card p-3 text-sm">
                  <span className="font-mono text-xs">{v.name}</span>
                  {v.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{v.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Phenotypes */}
        <Section title="Phenotypes" sub={`${d.phenotypes.length} terms`}>
          <Chips items={d.phenotypes} />
        </Section>

        {/* Mechanisms & pathways */}
        <Section
          title="Mechanisms & pathways"
          sub={`${d.mechanisms.length + d.pathways.length} entries`}
        >
          <Chips items={[...d.mechanisms, ...d.pathways]} />
        </Section>

        {/* Related diseases */}
        <Section title="Related diseases" sub={`${related.length} connections`}>
          {related.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No supported connections in the current graph.
            </p>
          )}
          <div className="space-y-3">
            {related.map((r) => (
              <Card key={r.disease.id} className="py-4">
                <CardContent className="px-4">
                  <div className="flex items-baseline justify-between flex-wrap gap-2">
                    <Link
                      href={`/disease/${r.disease.id}`}
                      className="font-medium underline underline-offset-4 hover:no-underline"
                    >
                      {r.disease.name}
                    </Link>
                    <Badge variant={r.connecting_edge.provenance === "inferred" ? "outline" : "default"}>
                      {r.connecting_edge.provenance === "inferred" ? "Atlas-inferred" : "Curated"} · p(valid) {pct(r.similarity)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {r.connecting_edge.description}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Shared phenotypes: {r.shared_phenotypes.map((p) => p.name).join(", ") || "none"} ·
                    Shared pathways: {r.shared_pathways.map((p) => p.name).join(", ") || "none"} ·
                    Genes: {r.genes.map((g) => g.name).join(", ") || "none"}
                  </p>
                  <Link
                    href={`/connection/${id}/${r.disease.id}`}
                    className="text-sm underline underline-offset-4 hover:no-underline mt-1 inline-block"
                  >
                    Why are these connected?
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>

        {/* Research: two-column grid like the prototype */}
        <div className="grid gap-10 lg:grid-cols-2">
          <Section title="Literature" sub={`${d.publications.length} publications`}>
            <ul className="space-y-3">
              {d.publications.map((p) => (
                <li key={p.id} className="text-sm">
                  <span className="font-medium">{p.name}</span>
                  <p className="text-xs text-muted-foreground">
                    {p.identifier}{p.year ? ` · ${p.year}` : ""}
                  </p>
                </li>
              ))}
              {d.publications.length === 0 && (
                <p className="text-sm text-muted-foreground">None in current dataset.</p>
              )}
            </ul>
          </Section>

          <Section title="Clinical studies" sub={`${d.studies.length} studies`}>
            <ul className="space-y-3">
              {d.studies.map((s) => (
                <li key={s.id} className="text-sm">
                  <span className="font-medium">{s.name}</span>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{s.identifier}</span>
                    {s.status ? ` · ${s.status.replaceAll("_", " ").toLowerCase()}` : ""}
                  </p>
                </li>
              ))}
              {d.studies.length === 0 && (
                <p className="text-sm text-muted-foreground">None in current dataset.</p>
              )}
            </ul>
          </Section>
        </div>

        <div className="grid gap-10 lg:grid-cols-2">
          <Section title="Researchers & institutions" sub={`${d.researchers.length} researchers`}>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {d.researchers.map((r) => (
                <li key={r.id} className="rounded border bg-card p-2 text-sm">
                  <span className="font-medium">{r.name}</span>
                  {r.affiliation && (
                    <p className="text-xs text-muted-foreground">{r.affiliation}</p>
                  )}
                </li>
              ))}
              {d.researchers.length === 0 && (
                <p className="text-sm text-muted-foreground">None in current dataset.</p>
              )}
            </ul>
          </Section>

          <Section title="Patient organisations" sub="curated">
            <ul className="grid grid-cols-1 gap-2">
              {d.organizations.map((o) => (
                <li key={o.id} className="rounded border bg-card p-2 text-sm">
                  <span className="font-medium">{o.name}</span>
                  {o.description && (
                    <p className="text-xs text-muted-foreground">{o.description}</p>
                  )}
                </li>
              ))}
              {d.organizations.length === 0 && (
                <p className="text-sm text-muted-foreground">None in current dataset.</p>
              )}
            </ul>
          </Section>
        </div>

        {d.assets.length > 0 && (
          <Section title="Research assets" sub={`${d.assets.length} assets`}>
            <Chips items={d.assets} />
          </Section>
        )}
      </div>
    </div>
  );
}
