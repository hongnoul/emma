"use client";
// Eval dashboard: is the edge judge calibrated? Toggles between the stored
// mock judge and real zero-shot Laya judgments (data/laya_judgments_zeroshot.json).
import { useEffect, useState } from "react";
import { api, EvalReport } from "@/lib/api";

type Judge = "mock" | "laya";

export default function EvalsPage() {
  const [judge, setJudge] = useState<Judge>("mock");
  const [r, setR] = useState<EvalReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setR(null);
    api.evals(judge).then(setR).catch((e) => setError(String(e)));
  }, [judge]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  return (
    <div className="space-y-6 max-w-2xl">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Edge-judge evaluation</h1>
        <p className="text-sm text-slate-500">
          p(valid) probabilities vs the hand-labeled demo gold set.
        </p>
        <div className="flex gap-2 text-sm">
          {(["mock", "laya"] as Judge[]).map((j) => (
            <button key={j} onClick={() => setJudge(j)}
              className={`rounded px-3 py-1 border ${judge === j ? "bg-blue-600 text-white border-blue-600" : "border-slate-300 text-slate-600"}`}>
              {j === "mock" ? "Mock judge (stored)" : "Laya zero-shot (real)"}
            </button>
          ))}
        </div>
      </header>

      {!r && <p className="text-slate-500">Loading…</p>}
      {r && r.n === 0 && <p className="text-amber-700 text-sm">{r.notes}</p>}
      {r && r.n > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4 text-center">
            {[["Accuracy @0.5", r.accuracy], ["Brier score", r.brier], ["ECE", r.ece]].map(([label, v]) => (
              <div key={label as string} className="border border-slate-200 rounded-lg p-4">
                <p className="text-2xl font-semibold">{v as number}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>

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

          <p className="text-sm text-slate-600 border-l-4 border-slate-200 pl-3">{r.notes}</p>
        </>
      )}
    </div>
  );
}
