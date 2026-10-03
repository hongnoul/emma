"""Decision service: the calibrated-judge seam.

This is where Laya (or any System One decision model) plugs in. The mock
implementation replays the decision blocks stored in graph.json, which were
generated with the same question-pack schema a real judge would answer.

To go live with Laya:

    pip install laya
    from laya import Router
    router = Router()

    def judge_edge(self, state, pack_id):
        pack = self.packs[pack_id]["questions"]
        result = router.predict(state, pack)
        return {
            "edge_valid": result["answers"]["edge_valid"]["noul"],
            "rel_probs": result["answers"]["rel_class"]["probabilities"],
            "evidence_level": {
                "expected": result["answers"]["evidence_level"]["score"],
                "probs": result["answers"]["evidence_level"]["probabilities"],
            },
            "contradicted": result["answers"]["contradicted"]["noul"],
            "decision_meta": {"model": "convaiinnovations/laya", "question_pack": pack_id, ...},
        }

All four questions share one forward pass (~33 ms on a T4, CPU-viable).
Recalibrate per question pack with laya's fit_* utilities against
data/gold_labels.json before trusting thresholds.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from ..models.schemas import Edge

DATA_DIR = Path(__file__).resolve().parents[3] / "data"


class DecisionService:
    def __init__(self):
        self.packs = json.loads((DATA_DIR / "question_packs.json").read_text())["packs"]

    def question_pack(self, pack_id: str) -> dict:
        return self.packs[pack_id]

    def judge_edge(self, edge: Edge, pack_id: str = "edge-validate-v1") -> dict:
        """Return the decision block for an edge.

        Mock: replays the stored block (generated against the same pack).
        TODO(laya): run the real model on edge.state as shown in the module docstring.
        """
        if edge.edge_valid is None:
            return {"edge_valid": None, "note": "edge has no state snippet; cannot judge"}
        return {
            "edge_valid": edge.edge_valid,
            "rel_probs": edge.rel_probs,
            "evidence_level": edge.evidence_level.model_dump() if edge.evidence_level else None,
            "contradicted": edge.contradicted,
            "decision_meta": edge.decision_meta.model_dump() if edge.decision_meta else None,
        }


@lru_cache(maxsize=1)
def get_decision_service() -> DecisionService:
    return DecisionService()
