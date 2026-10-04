"use client";
// Eval dashboard: is the edge judge calibrated? Five-way toggle across the
// stored mock judge, real zero-shot Laya / OpenAI judges (v1 pack), and the
// v2-pack runs (5-level ladder + superseded). Expert layer: soft-Brier,
// temperature, zombie traps, 90%-precision gate, 3:1 cost, contested edges.
import { useEffect, useState } from "react";
import { v1, EvalsReport } from "@/lib/v1";

type Judge = "mock" | "laya" | "openai" | "laya-v2" | "openai-v2";

const JUDGES: { id: Judge; label: string }[] = [
  { id: "mock", label: "Mock (stored)" },
  { id: "laya", label: "Laya zero-shot" },
  { id: "openai", label: "OpenAI zero-shot" },
  { id: "laya-v2", label: "Laya v2 +superseded" },
  { id: "openai-v2", label: "OpenAI v2 +superseded" },
];

export default function EvalsPage() {
  const [judge, setJudge] = useState<Judge>("openai");
  const [r, setR] = useState<EvalsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setR(null); setError(null);
    v1.evals(judge).then(setR).catch((e) => setError(String(e)));
  }, [judge]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Edge-judge evaluation</h1>
        <p className="text-sm text-slate-500">
          p(valid) vs the domain-expert overlay (31 edges, 3 contested with soft
          targets, 3 expert overrides of demo gold).
        </p>
        <div className="flex gap-2 text-sm flex-wrap">
          {JUDGES.map((j) => (
            <button key={j.id} onClick={() => setJudge(j.id)}
              className={`rounded px-3 py-1 border ${judge === j.id ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600"}`}>
              {j.label}
            </button>
          ))}
        </div>
      </header>

      {!r && <p className="text-slate-500">Loading…</p>}
      {r && r.n === 0 && <p className="text-amber-700 text-sm">{r.notes}</p>}
      {r && r.n > 0 && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
            {[["Accuracy", r.accuracy], ["Brier", r.brier], ["Soft-Brier", r.brier_soft],
              ["ECE", r.ece], ["T", r.temperature], ["Traps", r.trap_pass_rate]].map(([label, val]) => (
              <div key={label as string} className="border border-slate-200 rounded-lg p-3">
                <p className="text-xl font-semibold">{val as number ?? "–"}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>

          {r.precision_gate && (
            <section className="text-sm border border-blue-200 bg-blue-50/50 rounded-lg p-3">
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
                  <span className="w-20 text-slate-500">{b.range[0].toFixed(1)}–{b.range[1].toFixed(1)}</span>
                  <div className="flex-1 h-5 bg-slate-100 rounded relative">
                    {b.mean_pred != null && (
                      <div className="absolute inset-y-0 w-0.5 bg-blue-600" style={{ left: `${b.mean_pred * 100}%` }} title={`mean predicted ${b.mean_pred}`} />
                    )}
                    {b.frac_true != null && (
                      <div className="absolute inset-y-0 w-0.5 bg-red-600" style={{ left: `${b.frac_true * 100}%` }} title={`observed ${b.frac_true}`} />
                    )}
                  </div>
                  <span className="w-16 text-slate-500">{b.count} edges</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              <span className="text-blue-600 font-medium">blue</span> = mean predicted ·{" "}
              <span className="text-red-600 font-medium">red</span> = observed fraction true.
              Aligned marks = calibrated. Gaps = miscalibration.
            </p>
          </section>

          {r.trap_results && r.trap_results.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Zombie-knowledge traps</h2>
              <table className="w-full text-sm border border-slate-200">
                <thead className="bg-slate-50 text-left">
                  <tr><th className="p-2">Edge</th><th className="p-2">Pattern</th>
                    <th className="p-2">p(valid)</th><th className="p-2">Superseded</th><th className="p-2">Verdict</th></tr>
                </thead>
                <tbody>
                  {r.trap_results.map((t) => (
                    <tr key={t.edge_id} className="border-t border-slate-100">
                      <td className="p-2 font-mono text-xs">{t.edge_id}</td>
                      <td className="p-2 text-xs">{t.pattern.replace(/_/g, " ")}</td>
                      <td className="p-2">{t.p_valid?.toFixed(2) ?? "–"}</td>
                      <td className="p-2">{t.superseded != null ? t.superseded.toFixed(2) : "–"}</td>
                      <td className="p-2">
                        <span className={`text-xs rounded px-1.5 py-0.5 ${t.passed ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                          {t.passed ? (t.passed_via === "superseded_flag" ? "killed (superseded)" : "rejected") : "falls for it"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {r.contested && Object.keys(r.contested).length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Contested edges (experts disagree)</h2>
              <ul className="text-sm space-y-1">
                {Object.entries(r.contested).map(([eid, c]) => (
                  <li key={eid} className="border border-amber-200 bg-amber-50/50 rounded px-3 py-2">
                    <span className="font-mono text-xs">{eid}</span>: judge {c.p_valid.toFixed(2)} vs
                    expert soft target {c.soft_target.toFixed(2)} — {c.verdict}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-sm text-slate-600 border-l-4 border-slate-200 pl-3">{r.notes}</p>
        </>
      )}
    </div>
  );
}
