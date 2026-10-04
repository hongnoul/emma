"use client";
// Research opportunities + evidence-backed next steps.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, Opportunity } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function OpportunitiesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.opportunities(id).then(setOpps).catch((e) => setError(String(e))); }, [id]);

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!opps) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Research Opportunities</h1>
        <p className="text-sm text-muted-foreground">
          Research opportunities requiring expert validation. These are not medical recommendations.
        </p>
      </header>

      {opps.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No opportunities derived from the current graph. This reflects missing evidence, not absence of possibility.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {opps.map((o) => (
          <Card key={o.id} className="gap-3">
            <CardHeader className="gap-0">
              <div className="flex items-baseline justify-between gap-2">
                <CardTitle className="text-base">{o.title}</CardTitle>
                <Badge variant="secondary" className="shrink-0">{o.category}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><h3 className="text-xs font-semibold text-muted-foreground uppercase">What exists</h3><p>{o.what_exists}</p></div>
              <div><h3 className="text-xs font-semibold text-muted-foreground uppercase">Why it may be relevant</h3><p>{o.why_relevant}</p></div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Evidence</h3>
                <p className="text-xs text-muted-foreground">Graph edges: {o.evidence_edge_ids.join(", ")}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase">Requires validation</h3>
                <ul className="list-disc list-inside text-muted-foreground">
                  {o.needs_validation.map((v, i) => <li key={i}>{v}</li>)}
                </ul>
              </div>
              <Separator />
              <div>
                <h3 className="text-xs font-semibold uppercase">Potential next step</h3>
                <p>{o.next_step}</p>
              </div>
              <p className="text-xs text-muted-foreground italic">{o.disclaimer}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Link href={`/disease/${id}`} className="text-sm underline underline-offset-4 hover:no-underline">← Back to disease</Link>
    </div>
  );
}
