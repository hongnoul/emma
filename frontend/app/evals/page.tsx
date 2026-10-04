"use client";
// Eval dashboard: is the edge judge calibrated? Five-way toggle across the
// stored mock judge, real zero-shot Laya / OpenAI judges (v1 pack), and the
// v2-pack runs (5-level ladder + superseded). Expert layer: soft-Brier,
// temperature, zombie traps, 90%-precision gate, 3:1 cost, contested edges.
import { useEffect, useState } from "react";
import { v1, EvalsReport } from "@/lib/v1";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Judge = "mock" | "laya" | "openai" | "laya-v2" | "openai-v2";

const JUDGES: { id: Judge; label: string }[] = [
  { id: "mock", label: "Mock (stored)" },
  { id: "laya", label: "Laya zero-shot" },
  { id: "openai", label: "OpenAI zero-shot" },
  { id: "laya-v2", label: "Laya v2 +superseded" },
  { id: "openai-v2", label: "OpenAI v2 +superseded" },
];

function JudgeToggle({ judge, setJudge }: { judge: Judge; setJudge: (j: Judge) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {JUDGES.map((j) => (
        <Button key={j.id} size="sm" variant={judge === j.id ? "default" : "outline"}
          onClick={() => setJudge(j.id)}>
          {j.label}
        </Button>
      ))}
    </div>
  );
}

export default function EvalsPage() {
  const [judge, setJudge] = useState<Judge>("openai");
  const [r, setR] = useState<EvalsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setR(null); setError(null);
    v1.evals(judge)
      .then(setR)
      .catch((e) => {
        // Older backends only support mock|laya; fall back once from the default.
        if (judge === "openai" && String(e).includes("string_pattern_mismatch")) setJudge("laya");
        else setError(String(e));
      });
  }, [judge]);

  if (error) return (
    <div className="space-y-6 max-w-3xl">
      <JudgeToggle judge={judge} setJudge={setJudge} />
      <p className="text-sm font-medium">{error}</p>
      <p className="text-xs text-muted-foreground">This deployment may not support the selected judge. Try another.</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Edge-judge evaluation</h1>
        <p className="text-sm text-muted-foreground">
          p(valid) vs the domain-expert overlay (31 edges, 3 contested with soft
          targets, 3 expert overrides of demo gold).
        </p>
        <JudgeToggle judge={judge} setJudge={setJudge} />
      </header>

      {!r && <p className="text-muted-foreground">Loading…</p>}
      {r && r.n === 0 && <p className="text-sm font-medium">{r.notes}</p>}
      {r && r.n > 0 && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            {[["Accuracy", r.accuracy], ["Brier", r.brier], ["Soft-Brier", r.brier_soft],
              ["ECE", r.ece], ["T", r.temperature], ["Traps", r.trap_pass_rate]].map(([label, val]) => (
              <Card key={label as string} className="py-3">
                <CardContent className="px-3">
                  <p className="text-xl font-semibold">{val as number ?? "–"}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {r.precision_gate && (
            <section className="text-sm border rounded-lg bg-muted/50 p-3">
              <span className="font-semibold">90%-precision gate: </span>
              accept at p ≥ {r.precision_gate.threshold} ({r.precision_gate.accepted}/{r.precision_gate.n} accepted,
              abstains {((r.precision_gate.abstention_rate ?? 0) * 100).toFixed(0)}%).
              {r.cost_at_0_5 && <> Expert cost (3:1 FP) {r.cost_at_0_5.total_cost} at 0.5 → {r.cost_at_0_75?.total_cost} at 0.75.</>}
            </section>
          )}

          <section>
            <h2 className="font-semibold mb-2">Reliability (predicted vs observed)</h2>
            <div className="space-y-1 text-xs">
              {r.bins.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-20 text-muted-foreground">{b.range[0].toFixed(1)}–{b.range[1].toFixed(1)}</span>
                  <div className="flex-1 h-5 bg-muted rounded relative">
                    {b.mean_pred != null && (
                      <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${b.mean_pred * 100}%` }} title={`mean predicted ${b.mean_pred}`} />
                    )}
                    {b.frac_true != null && (
                      <div className="absolute inset-y-0 w-[3px] bg-muted-foreground/60" style={{ left: `${b.frac_true * 100}%` }} title={`observed ${b.frac_true}`} />
                    )}
                  </div>
                  <span className="w-16 text-muted-foreground">{b.count} edges</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="font-medium text-foreground">thin black</span> = mean predicted ·{" "}
              <span className="font-medium">thick gray</span> = observed fraction true.
              Aligned marks = calibrated. Gaps = miscalibration.
            </p>
          </section>

          {r.trap_results && r.trap_results.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Zombie-knowledge traps</h2>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Edge</TableHead><TableHead>Pattern</TableHead>
                      <TableHead>p(valid)</TableHead><TableHead>Superseded</TableHead><TableHead>Verdict</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.trap_results.map((t) => (
                      <TableRow key={t.edge_id}>
                        <TableCell className="font-mono text-xs">{t.edge_id}</TableCell>
                        <TableCell className="text-xs">{t.pattern.replace(/_/g, " ")}</TableCell>
                        <TableCell>{t.p_valid?.toFixed(2) ?? "–"}</TableCell>
                        <TableCell>{t.superseded != null ? t.superseded.toFixed(2) : "–"}</TableCell>
                        <TableCell>
                          <Badge variant={t.passed ? "secondary" : "default"}>
                            {t.passed ? (t.passed_via === "superseded_flag" ? "killed (superseded)" : "rejected") : "falls for it"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {r.contested && Object.keys(r.contested).length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Contested edges (experts disagree)</h2>
              <ul className="text-sm space-y-1">
                {Object.entries(r.contested).map(([eid, c]) => (
                  <li key={eid} className="border bg-muted/50 rounded px-3 py-2">
                    <span className="font-mono text-xs">{eid}</span>: judge {c.p_valid.toFixed(2)} vs
                    expert soft target {c.soft_target.toFixed(2)} — {c.verdict}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-sm text-muted-foreground border-l-4 pl-3">{r.notes}</p>
        </>
      )}
    </div>
  );
}
