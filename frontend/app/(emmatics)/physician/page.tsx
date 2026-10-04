"use client";
// Physician partition home: live stats + entry points into the three
// interrogation workflows (triage, edge workbench, path inspector).
import { useEffect, useState } from "react";
import Link from "next/link";
import { v1, Meta, EdgesResponse } from "@/lib/v1";
import { Card, CardContent } from "@/components/ui/card";

export default function PhysicianHome() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bands, setBands] = useState<{ established: number; review: number; hidden: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    v1.meta().then(setMeta).catch((e) => setError(String(e)));
    Promise.all([
      v1.edges({ judged_only: true, min_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, min_valid: 0.4, max_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, max_valid: 0.4, limit: 1 }),
    ]).then(([a, r, l]: EdgesResponse[]) =>
      setBands({ established: a.total, review: r.total, hidden: l.total })
    ).catch(() => { /* non-fatal */ });
  }, []);

  if (error) return <p className="text-sm font-medium">{error}</p>;

  const judgeLive = meta?.judge && meta.judge !== "none";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Evidence interrogation workbench</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every inferred connection in Emmatics carries a calibrated decision block
          from a typed-judgment model. This partition is for interrogating those
          judgments: triage the uncertain band, ablate evidence to see what carries
          a belief, and re-examine weak hops in inference paths.
        </p>
        {meta && (
          <p className="text-xs text-muted-foreground">
            generation <span className="font-mono">{meta.generation_id}</span> ·{" "}
            {meta.nodes.toLocaleString()} nodes · {meta.edges.toLocaleString()} edges ·{" "}
            judge:{" "}
            <span className={judgeLive ? "font-medium text-foreground" : ""}>
              {judgeLive ? `${meta.judge} (live)` : "offline — stored judgments only"}
            </span>
          </p>
        )}
      </header>

      {bands && (
        <section className="grid max-w-2xl grid-cols-3 gap-2 sm:gap-4">
          {[
            ["established ≥ 0.90", bands.established, "bg-primary text-primary-foreground"],
            ["review 0.40–0.90", bands.review, "bg-secondary text-secondary-foreground border"],
            ["hidden < 0.40", bands.hidden, "border border-dashed text-muted-foreground"],
          ].map(([label, n, cls]) => (
            <div key={label as string} className={`rounded-lg p-4 text-center ${cls}`}>
              <p className="text-2xl font-semibold">{(n as number).toLocaleString()}</p>
              <p className="text-xs">{label}</p>
            </div>
          ))}
        </section>
      )}

      <section className="grid sm:grid-cols-3 gap-4">
        <WorkflowCard href="/physician/triage" title="Triage queue"
          body="Fly through the review band with j/k · a/r keys. Your verdicts build a local gold set and recalibrate the reliability view live." />
        <WorkflowCard href="/physician/triage" title="Edge workbench"
          body="Open any edge: full decision block, leave-one-out evidence ablation (which symptom carries the belief), and a what-if editor that re-judges as you type." />
        <WorkflowCard href="/physician/paths" title="Path inspector"
          body="How are two diseases connected? See every hop's probability, the path's joint confidence, and the weakest link highlighted." />
      </section>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Decision semantics: p(valid) is a calibrated probability, not a fact claim.
        Check <Link className="underline underline-offset-4 hover:no-underline" href="/evals">the calibration report</Link> before
        gating clinical workflows on any threshold.
      </p>
    </div>
  );
}

function WorkflowCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href}>
      <Card className="h-full py-4 transition hover:shadow-sm hover:border-foreground/30">
        <CardContent className="px-4">
          <h2 className="font-semibold mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground">{body}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
