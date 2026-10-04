"""Eval harness: measures the edge judge against expert-validated labels.

Metrics over judged edges (those with an edge_valid probability):
  accuracy  at threshold 0.5 (hard labels)
  brier     mean squared error of p(valid) vs label
  brier_soft  Brier vs expert soft targets (contested edges count 0.5, so a
              judge that says 0.9 on a genuinely contested edge is penalized)
  ece       expected calibration error over equal-width bins
  cost      expert-cost accounting: FP costs 3, FN costs 1 (Q17), at 0.5 and
            at the cost-optimal 0.75 threshold
  traps     zombie-suite pass rate: traps[judge p(valid) < 0.40] / traps
  temperature  NLL-optimal temperature on soft targets + calibrated Brier
  precision_gate  empirical threshold for 90% precision + abstention rate
  contested  per-contested-edge judge probabilities (expert-disagreement set)

Label source: data/expert_labels.json when present (domain-expert overlay,
Oct 2026; 3 overrides of the demo gold set), else data/gold_labels.json.

Scores the stored (mock) judge by default. If data/laya_judgments_zeroshot.json
exists (produced by scripts/judge_with_laya.py), judge="laya" scores the real
zero-shot Laya judgments against the same labels. Likewise,
judge="openai" scores data/openai_judgments_zeroshot.json (produced by
scripts/judge_with_openai.py).

Run standalone:  python -m app.services.evals   (from backend/)
Served at:       GET /api/evals              (mock)
                 GET /api/evals?judge=laya   (real zero-shot Laya, if file present)
                 GET /api/evals?judge=openai (OpenAI logprobs judge, if file present)
Also:            GET /v1/evals?judge=...     (same report plus trust layer)
"""
from __future__ import annotations

import json
from pathlib import Path

from ..models.schemas import EvalReport
from .graph_store import get_store

import os as _os
DATA_DIR = Path(_os.environ.get("EMMATICS_DATA_DIR", _os.environ.get("ATLAS_DATA_DIR") or Path(__file__).resolve().parents[3] / "data"))
N_BINS = 5


_JUDGMENT_FILES = {
    "laya": "laya_judgments_zeroshot.json",
    "openai": "openai_judgments_zeroshot.json",
    "laya-v2": "laya_judgments_v2.json",
    "openai-v2": "openai_judgments_v2.json",
}


def _stored_probs(judge: str) -> dict[str, float] | None:
    f = DATA_DIR / _JUDGMENT_FILES[judge]
    if not f.exists():
        return None
    return {k: v["edge_valid"] for k, v in json.loads(f.read_text())["judgments"].items()}


def _stored_full(judge: str) -> dict | None:
    """Full judgment records (with superseded/evidence_level when present)."""
    f = DATA_DIR / _JUDGMENT_FILES.get(judge, "")
    if not f or not f.exists():
        return None
    return json.loads(f.read_text())["judgments"]


def _expert_labels() -> tuple[dict[str, int], dict[str, float], dict]:
    """Return (hard labels, soft targets, full records), preferring the expert overlay."""
    from .trust import expert_targets
    recs = expert_targets()
    hard = {eid: int(r["label"]) for eid, r in recs.items()}
    soft = {eid: float(r.get("soft_target", r["label"])) for eid, r in recs.items()}
    return hard, soft, recs


def run_evals(judge: str = "mock") -> EvalReport:
    from .trust import (calibrate_p, cost_of_decisions, fit_temperature,
                        precision_gate, trap_suite)
    store = get_store()
    hard, soft, recs = _expert_labels()
    if judge in _JUDGMENT_FILES:
        probs = _stored_probs(judge)
        if probs is None:
            return EvalReport(n=0, accuracy=0, brier=0, ece=0, bins=[],
                              notes=f"no {judge} judgments found; run "
                                    f"scripts/judge_with_{judge}.py first")
        pairs = [(probs[eid], label) for eid, label in hard.items() if eid in probs]
    else:
        pairs = [(store.edges[eid].edge_valid, label)
                 for eid, label in hard.items()
                 if eid in store.edges and store.edges[eid].edge_valid is not None]
    n = len(pairs)
    if n == 0:
        return EvalReport(n=0, accuracy=0, brier=0, ece=0, bins=[], notes="no judged edges")

    accuracy = sum(1 for p, y in pairs if (p >= 0.5) == (y == 1)) / n
    brier = sum((p - y) ** 2 for p, y in pairs) / n

    bins = []
    ece = 0.0
    for b in range(N_BINS):
        lo, hi = b / N_BINS, (b + 1) / N_BINS
        members = [(p, y) for p, y in pairs if lo <= p < hi or (b == N_BINS - 1 and p == 1.0)]
        if not members:
            bins.append({"range": [lo, hi], "count": 0, "mean_pred": None, "frac_true": None})
            continue
        mean_pred = sum(p for p, _ in members) / len(members)
        frac_true = sum(y for _, y in members) / len(members)
        ece += (len(members) / n) * abs(mean_pred - frac_true)
        bins.append({"range": [lo, hi], "count": len(members),
                     "mean_pred": round(mean_pred, 3), "frac_true": round(frac_true, 3)})

    # ---- expert layer: soft Brier, temperature, traps, gate, cost ----
    # edge_id -> p for the trust metrics
    if judge in _JUDGMENT_FILES:
        all_probs = _stored_probs(judge) or {}
        prob_map = {eid: all_probs[eid] for eid in hard if eid in all_probs}
    else:
        prob_map = {eid: store.edges[eid].edge_valid for eid in hard
                    if eid in store.edges and store.edges[eid].edge_valid is not None}
    soft_pairs = [(prob_map[eid], soft[eid]) for eid in prob_map if eid in soft]
    brier_soft = (sum((p - y) ** 2 for p, y in soft_pairs) / len(soft_pairs)
                  if soft_pairs else 0.0)
    temperature = fit_temperature(prob_map)
    cal_probs = {eid: calibrate_p(p, temperature) for eid, p in prob_map.items()}
    cal_pairs = [(cal_probs[eid], hard[eid]) for eid in cal_probs if eid in hard]
    brier_cal = (sum((p - y) ** 2 for p, y in cal_pairs) / len(cal_pairs)
                 if cal_pairs else 0.0)
    traps = trap_suite()
    full = _stored_full(judge) if judge in _JUDGMENT_FILES else None
    trap_results = []
    for t in traps:
        eid = t["edge_id"]
        p = prob_map.get(eid)
        passed = p is not None and p < 0.40
        row = {"edge_id": eid, "pattern": t["pattern"],
               "p_valid": round(p, 3) if p is not None else None,
               "passed": passed}
        if full and eid in full and full[eid].get("superseded") is not None:
            sup = full[eid]["superseded"]
            row["superseded"] = sup
            # v2: a trap also passes if the judge explicitly flags superseded
            if sup >= 0.70 and t["pattern"] in ("superseded_case_report",
                                                "stale_database_annotation",
                                                "generic_phenotypes_plus_stale_annotation"):
                row["passed"] = True
                row["passed_via"] = "superseded_flag"
        trap_results.append(row)
    trap_rate = (sum(1 for r in trap_results if r["passed"]) / len(trap_results)
                 if trap_results else None)
    gate = precision_gate(prob_map, hard, target_precision=0.90)
    cost50 = cost_of_decisions(prob_map, hard, threshold=0.5)
    cost75 = cost_of_decisions(prob_map, hard, threshold=0.75)
    contested = {eid: {"p_valid": round(prob_map[eid], 3),
                       "soft_target": soft[eid],
                       "verdict": recs[eid].get("verdict")}
                 for eid in recs if recs[eid].get("contested") and eid in prob_map}
    n_contested = sum(1 for r in recs.values() if r.get("contested"))
    n_overrides = sum(1 for eid in ("DEMO-EDGE-006", "DEMO-EDGE-078", "DEMO-EDGE-087")
                      if eid in recs)

    notes = (
        f"judge={judge} vs expert-validated labels (n={n}, {n_contested} contested, "
        f"{n_overrides} expert overrides of demo gold). "
        + ("Real zero-shot Laya (convaiinnovations/laya). "
           if judge.startswith("laya") else
           "OpenAI logprobs judge (single-token answers, renormalized top_logprobs). "
           if judge.startswith("openai") else
           "Mock-judge probabilities (hand-tuned, deliberately miscalibrated traps). ")
        + ("Question pack edge-validate-v2 (5-level ladder + superseded). "
           if judge.endswith("-v2") else "")
        + f"Soft-Brier {brier_soft:.3f} (contested=0.5 targets); "
          f"T={temperature} calibrated Brier {brier_cal:.3f}. "
        + (f"Zombie traps {sum(1 for r in trap_results if r['passed'])}/{len(trap_results)}. "
           if trap_results else "")
        + f"90%-precision gate at p>={gate['threshold']} "
          f"({gate['accepted']}/{gate['n']} accepted, abstains {gate['abstention_rate']}). "
          f"Expert cost (3:1) {cost50['total_cost']} at 0.5, {cost75['total_cost']} at 0.75. "
          "Small-sample demo: thresholds are estimates until the ~200-edge real gold set lands."
    )
    report = EvalReport(
        n=n, accuracy=round(accuracy, 3), brier=round(brier, 3), ece=round(ece, 3), bins=bins,
        notes=notes,
    )
    # attach the expert layer as extra fields (kept out of the frozen schema
    # so legacy clients are unaffected; v1/evals promotes them explicitly)
    report_extra = {
        "brier_soft": round(brier_soft, 3),
        "temperature": temperature,
        "brier_calibrated": round(brier_cal, 3),
        "trap_pass_rate": round(trap_rate, 3) if trap_rate is not None else None,
        "trap_results": trap_results,
        "precision_gate": gate,
        "cost_at_0_5": cost50,
        "cost_at_0_75": cost75,
        "contested": contested,
    }
    object.__setattr__(report, "_expert_extra", report_extra)
    return report


def expert_extra(report: EvalReport) -> dict:
    return getattr(report, "_expert_extra", {})


if __name__ == "__main__":
    import sys
    judge = sys.argv[1] if len(sys.argv) > 1 else "mock"
    r = run_evals(judge)
    out = r.model_dump()
    out.update(expert_extra(r))
    print(json.dumps(out, indent=2))
