"""Eval harness: measures the edge judge against gold labels.

Metrics over judged edges (those with an edge_valid probability):
  accuracy  at threshold 0.5
  brier     mean squared error of p(valid) vs label
  ece       expected calibration error over equal-width bins

Scores the stored (mock) judge by default. If data/laya_judgments_zeroshot.json
exists (produced by scripts/judge_with_laya.py), judge="laya" scores the real
zero-shot Laya judgments against the same gold labels.

Run standalone:  python -m app.services.evals   (from backend/)
Served at:       GET /api/evals            (mock)
                 GET /api/evals?judge=laya (real zero-shot Laya, if file present)
"""
from __future__ import annotations

import json
from pathlib import Path

from ..models.schemas import EvalReport
from .graph_store import get_store

import os as _os
DATA_DIR = Path(_os.environ.get("ATLAS_DATA_DIR") or Path(__file__).resolve().parents[3] / "data")
N_BINS = 5


def _laya_probs() -> dict[str, float] | None:
    f = DATA_DIR / "laya_judgments_zeroshot.json"
    if not f.exists():
        return None
    return {k: v["edge_valid"] for k, v in json.loads(f.read_text())["judgments"].items()}


def run_evals(judge: str = "mock") -> EvalReport:
    store = get_store()
    gold = {g["edge_id"]: g["label"]
            for g in json.loads((DATA_DIR / "gold_labels.json").read_text())["labels"]}
    if judge == "laya":
        probs = _laya_probs()
        if probs is None:
            return EvalReport(n=0, accuracy=0, brier=0, ece=0, bins=[],
                              notes="no Laya judgments found; run scripts/judge_with_laya.py first")
        pairs = [(probs[eid], label) for eid, label in gold.items() if eid in probs]
    else:
        pairs = [(store.edges[eid].edge_valid, label)
                 for eid, label in gold.items()
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

    return EvalReport(
        n=n, accuracy=round(accuracy, 3), brier=round(brier, 3), ece=round(ece, 3), bins=bins,
        notes=(
            f"judge={judge}. "
            + ("Real zero-shot Laya (convaiinnovations/laya) probabilities vs the same gold set. "
               "High ECE / trap misses are expected zero-shot; fine-tune and fit per-pack "
               "temperatures before gating automation."
               if judge == "laya" else
               "Mock-judge probabilities vs hand-labeled demo gold set (includes deliberate "
               "miscalibrated trap edges). Compare with ?judge=laya once "
               "scripts/judge_with_laya.py has been run.")
        ),
    )


if __name__ == "__main__":
    import sys
    judge = sys.argv[1] if len(sys.argv) > 1 else "mock"
    print(run_evals(judge).model_dump_json(indent=2))
