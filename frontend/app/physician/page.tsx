"use client";
// Physician partition home: live stats + entry points into the three
// interrogation workflows (triage, edge workbench, path inspector).
import { useEffect, useState } from "react";
import Link from "next/link";
import { v1, Meta, EdgesResponse } from "@/lib/v1";

export default function PhysicianHome() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bands, setBands] = useState<{ accept: number; review: number; low: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    v1.meta().then(setMeta).catch((e) => setError(String(e)));
    Promise.all([
      v1.edges({ judged_only: true, min_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, min_valid: 0.6, max_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, max_valid: 0.6, limit: 1 }),
    ]).then(([a, r, l]: EdgesResponse[]) =>
      setBands({ accept: a.total, review: r.total, low: l.total })
    ).catch(() => { /* non-fatal */ });
  }, []);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  const judgeLive = meta?.judge && meta.judge !== "none";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Evidence interrogation workbench</h1>
        <p className="text-sm text-slate-600 max-w-2xl">
          Every inferred connection in the atlas carries a calibrated decision block
          from a typed-judgment model. This partition is for interrogating those
          judgments: triage the uncertain band, ablate evidence to see what carries
          a belief, and re-examine weak hops in inference paths.
        </p>
        {meta && (
          <p className="text-xs text-slate-500">
            generation <span className="font-mono">{meta.generation_id}</span> ·{" "}
            {meta.nodes.toLocaleString()} nodes · {meta.edges.toLocaleString()} edges ·{" "}
            judge:{" "}
            <span className={judgeLive ? "text-green-700 font-medium" : "text-slate-400"}>
              {judgeLive ? `${meta.judge} (live)` : "offline — stored judgments only"}
            </span>
          </p>
        )}
      </header>

      {bands && (
        <section className="grid grid-cols-3 gap-4 max-w-2xl">
          {[
            ["auto-accept ≥ 0.90", bands.accept, "text-green-700 border-green-200 bg-green-50/50"],
            ["review 0.60–0.90", bands.review, "text-amber-700 border-amber-200 bg-amber-50/50"],
            ["low < 0.60", bands.low, "text-red-700 border-red-200 bg-red-50/50"],
          ].map(([label, n, cls]) => (
            <div key={label as string} className={`border rounded-lg p-4 text-center ${cls}`}>
              <p className="text-2xl font-semibold">{(n as number).toLocaleString()}</p>
              <p className="text-xs">{label}</p>
            </div>
          ))}
        </section>
      )}

      <section className="grid sm:grid-cols-3 gap-4">
        <Card href="/physician/triage" title="Triage queue"
          body="Fly through the review band with j/k · a/r keys. Your verdicts build a local gold set and recalibrate the reliability view live." />
        <Card href="/physician/triage" title="Edge workbench"
          body="Open any edge: full decision block, leave-one-out evidence ablation (which symptom carries the belief), and a what-if editor that re-judges as you type." />
        <Card href="/physician/paths" title="Path inspector"
          body="How are two diseases connected? See every hop's probability, the path's joint confidence, and the weakest link highlighted." />
      </section>

      <p className="text-xs text-slate-400 max-w-2xl">
        Decision semantics: p(valid) is a calibrated probability, not a fact claim.
        Check <Link className="underline" href="/evals">the calibration report</Link> before
        gating clinical workflows on any threshold.
      </p>
    </div>
  );
}

function Card({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="block border border-slate-200 bg-white rounded-lg p-4 hover:border-indigo-300 hover:shadow-sm transition">
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-sm text-slate-600">{body}</p>
    </Link>
  );
}
