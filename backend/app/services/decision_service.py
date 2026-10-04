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

import os as _os
DATA_DIR = Path(_os.environ.get("ATLAS_DATA_DIR") or Path(__file__).resolve().parents[3] / "data")


class DecisionService:
    def __init__(self):
        self.packs = json.loads((DATA_DIR / "question_packs.json").read_text())["packs"]

    def question_pack(self, pack_id: str) -> dict:
        return self.packs[pack_id]

    def judge_edge(self, edge: Edge, pack_id: str = "edge-validate-v1") -> dict:
        """Return the decision block for an edge.

        Mock: replays the stored block (generated against the same pack).
        For the real judge, set ATLAS_JUDGE=laya (see LayaDecisionService).
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


def _judge_state(edge: Edge) -> str | None:
    """Build the human-readable state string a judge model sees for an edge."""
    if not edge.state:
        return None
    from .graph_store import get_store
    store = get_store()
    src = store.get_node(edge.source)
    tgt = store.get_node(edge.target)
    src_name = src.name if src else edge.source
    tgt_name = tgt.name if tgt else edge.target
    return (f"Claim: {src_name} --{edge.rel_type}--> {tgt_name}.\n"
            f"Claim description: {edge.description}\nEvidence: {edge.state}")


class LayaDecisionService(DecisionService):
    """Real judge backed by a locally hosted Laya model (pip install laya).

    Enabled with ATLAS_JUDGE=laya. First call downloads the checkpoint
    (~1.4 GB). Measured on an M-series Mac against the demo gold set:
    152 ms/edge for all 4 questions in one forward pass; zero-shot
    accuracy 0.742 / Brier 0.179 / ECE 0.162 (vs the mock's hand-tuned
    0.903/0.090/0.165). Zero-shot Laya misses subtle traps (e.g. the
    superseded legacy edge judged p(valid)=0.72), confirming the README
    guidance: fine-tune and fit per-pack temperatures on a real gold set
    before gating automation on these probabilities.
    """

    def __init__(self):
        super().__init__()
        from laya import Router  # lazy: only imported when ATLAS_JUDGE=laya
        self._router = Router(preload=False)

    def judge_edge(self, edge: Edge, pack_id: str = "edge-validate-v1") -> dict:
        state = _judge_state(edge)
        if state is None:
            return {"edge_valid": None, "note": "edge has no state snippet; cannot judge"}
        from datetime import date
        pack = self.packs[pack_id]["questions"]
        a = self._router.predict(state, pack)["answers"]
        level_names = pack["evidence_level"]["criteria"]
        level_probs = a["evidence_level"]["probabilities"]
        return {
            "edge_valid": a["edge_valid"]["noul"],
            "rel_probs": a["rel_class"]["probabilities"],
            "evidence_level": {
                "expected": a["evidence_level"]["score"],
                "probs": {level_names[int(k)]: v for k, v in level_probs.items()},
            },
            "contradicted": a["contradicted"]["noul"],
            "decision_meta": {"model": "convaiinnovations/laya", "question_pack": pack_id,
                              "judged_at": date.today().isoformat()},
        }


class OpenAIDecisionService(DecisionService):
    """Real judge backed by OpenAI logprobs (challenge requirement: 'leverage
    OpenAI's models or tools').

    Enabled with ATLAS_JUDGE=openai. Each pack question becomes one
    single-token Chat Completions call with logprobs; the top_logprobs mass is
    renormalized over the valid answers to recover a probability distribution
    (see openai_judge.py). Default model gpt-4o-mini; spend is estimated per
    call and hard-capped by ATLAS_OPENAI_BUDGET_USD (default $5).
    """

    def __init__(self):
        super().__init__()
        from .openai_judge import OpenAIJudge  # lazy: only when ATLAS_JUDGE=openai
        self._router = OpenAIJudge()

    def judge_edge(self, edge: Edge, pack_id: str = "edge-validate-v1") -> dict:
        state = _judge_state(edge)
        if state is None:
            return {"edge_valid": None, "note": "edge has no state snippet; cannot judge"}
        from datetime import date
        pack = self.packs[pack_id]["questions"]
        a = self._router.predict(state, pack)["answers"]
        level_names = pack["evidence_level"]["criteria"]
        level_probs = a["evidence_level"]["probabilities"]
        return {
            "edge_valid": a["edge_valid"]["noul"],
            "rel_probs": a["rel_class"]["probabilities"],
            "evidence_level": {
                "expected": a["evidence_level"]["score"],
                "probs": {level_names[int(k)]: v for k, v in level_probs.items()},
            },
            "contradicted": a["contradicted"]["noul"],
            "decision_meta": {"model": f"openai/{self._router.model}", "question_pack": pack_id,
                              "judged_at": date.today().isoformat()},
        }


@lru_cache(maxsize=1)
def get_decision_service() -> DecisionService:
    import os
    judge = os.environ.get("ATLAS_JUDGE")
    if judge == "laya":
        return LayaDecisionService()
    if judge == "openai":
        return OpenAIDecisionService()
    return DecisionService()
