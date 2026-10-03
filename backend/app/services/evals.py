"""Eval harness: measures the edge judge against gold labels.

Metrics over judged edges (those with an edge_valid probability):
  accuracy  at threshold 0.5
  brier     mean squared error of p(valid) vs label
  ece       expected calibration error over equal-width bins

Run standalone:  python -m app.services.evals   (from backend/)
Served at:       GET /api/evals
"""
from __future__ import annotations

import json
from pathlib import Path

from ..models.schemas import EvalReport
from .graph_store import get_store

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
N_BINS = 5


def run_evals() -> EvalReport:
    store = get_store()
    gold = {g["edge_id"]: g["label"]
            for g in json.loads((DATA_DIR / "gold_labels.json").read_text())["labels"]}
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
        notes=("Mock-judge probabilities vs hand-labeled demo gold set (includes deliberate "
               "miscalibrated trap edges). Re-run after swapping in Laya; if ECE is high, fit "
               "a per-question-pack temperature on this gold set."),
    )


if __name__ == "__main__":
    print(run_evals().model_dump_json(indent=2))
