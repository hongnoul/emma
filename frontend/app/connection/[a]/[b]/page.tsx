"use client";
// "Why are these connected?" page. Trust layer: server p_path with
// weakest-link, audience toggle (researcher vs patient gate), per-edge gate
// chips with expert caveat language, zombie edges struck through.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, ConnectionExplanation, pct } from "@/lib/api";
import { v1, TrustBlock, actionCls, band } from "@/lib/v1";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!c) return <p className="text-muted-foreground">Loading…</p>;

  const gateFor = (edgeId: string) => trust?.edges.find((g) => g.edge_id === edgeId);
  const isZombie = (edgeId: string) => {
    const g = gateFor(edgeId);
    return g?.band === "hidden" || g?.action === "hidden";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Why are these connected?</h1>

      <div className="flex items-center gap-2 text-xs">
        {(["researcher", "patient"] as const).map((x) => (
          <Button key={x} size="sm" variant={audience === x ? "default" : "outline"}
            onClick={() => setAudience(x)}>
            {x === "researcher" ? "Researcher view" : "Patient view"}
          </Button>
        ))}
        {trust?.p_path != null && (
          <span className="ml-2 text-sm text-muted-foreground">
            path confidence <span className="font-mono font-semibold text-foreground">{pct(trust.p_path)}</span>
            {trust.weakest_p != null && <span> (weakest hop {pct(trust.weakest_p)})</span>}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap text-sm">
        {c.path.map((step, i) => (
          <span key={step.node.id} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted-foreground" title={step.edge?.rel_type}>—{step.edge?.rel_type}→</span>}
            <Badge variant={step.node.type === "Disease" ? "default" : "secondary"} className="font-normal">
              {step.node.name}
            </Badge>
          </span>
        ))}
        {c.path.length === 0 && <span className="text-muted-foreground">No supported route found in the current graph.</span>}
      </div>

      <p className="border-l-4 pl-4">{c.narrative}</p>

      <div className="grid sm:grid-cols-3 gap-4 text-sm">
        {([["What is known", c.known], ["What is inferred", c.inferred], ["What remains uncertain", c.uncertain]] as const).map(([title, items]) => (
          <Card key={title} className="py-4 gap-2">
            <CardHeader className="px-4"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
            <CardContent className="px-4">
              {items.length ? <ul className="space-y-1">{items.map((k, i) => <li key={i}>{k}</li>)}</ul> : <p className="text-muted-foreground">—</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-2">Evidence table</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Relationship</TableHead><TableHead>Provenance</TableHead>
                <TableHead>Source</TableHead><TableHead>p(valid)</TableHead>
                <TableHead>p(contradicted)</TableHead><TableHead>Publications</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.evidence_edges.map((e) => {
                const g = gateFor(e.id);
                const zombie = isZombie(e.id);
                const bd = band(e.edge_valid);
                return (
                <TableRow key={e.id} className={`align-top ${zombie ? "bg-muted/50" : ""}`}>
                  <TableCell className={`whitespace-normal ${zombie ? "line-through text-muted-foreground" : ""}`}>{e.rel_type}
                    <p className="text-xs text-muted-foreground">{e.description}</p>
                    {zombie && <p className="text-xs font-medium no-underline">superseded — struck through, do not act on this</p>}
                    {g && <p><span className={`text-xs rounded px-1.5 py-0.5 ${actionCls(g.action)}`} title={g.reason}>{g.action.replace(/_/g, " ")}</span></p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.provenance === "inferred" ? "outline" : "secondary"}>
                      {e.provenance}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{e.source_db}</TableCell>
                  <TableCell><span className={`text-xs rounded px-1.5 py-0.5 ${bd.cls}`}>{pct(e.edge_valid)} {bd.label}</span></TableCell>
                  <TableCell>{pct(e.contradicted)}</TableCell>
                  <TableCell className="text-xs whitespace-normal">
                    {e.supporting_publications.join(", ") || "—"}
                    {e.contradictory_evidence.length > 0 && <p className="font-medium">contradicted by {e.contradictory_evidence.join(", ")}</p>}
                    {g?.caveat && g.action !== "show" && <p className="text-muted-foreground mt-1">{g.caveat}</p>}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="flex gap-4 text-sm">
        <Link href={`/disease/${a}`} className="underline underline-offset-4 hover:no-underline">← {c.source.name}</Link>
        <Link href={`/opportunities/${a}`} className="underline underline-offset-4 hover:no-underline">Research opportunities →</Link>
      </div>
    </div>
  );
}
