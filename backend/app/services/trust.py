"""Trust layer: turns judge probabilities into calibrated, gated decisions.

Encodes the domain-expert policy (Oct 2026 questionnaire, sections B-E):

  B. Evidence ladder: 4 levels -> 5 ordered levels + disputed/refuted handling.
     Single case report sits at hypothesis; model-only replication sits at
     supported, never replicated (replicated means replicated in humans).
     Implemented as the ``edge-validate-v2`` question pack; this module reads
     both v1 (4-level) and v2 (5-level) evidence blocks.
  C. Operating thresholds: patient view shows established only at
     p(valid) >= 0.90 (plus replicated evidence); hides below 0.40;
     middle band carries caveat language. False positives cost ~3x false
     negatives in the patient view (Q17). Solid-but-contradicted edges show
     with warning to researchers, suppress for patients (Q18).
  D. Zombie-trap suite lives in data/trap_suite.json; scored in evals.
  E. Contested edges carry soft targets; "what would change your answer"
     becomes per-edge validation guidance (stored in expert_labels.json).

Math provided:
  - per-judge temperature scaling (fit on expert soft targets, NLL grid
    search), so any judge's raw p_valid maps to a calibrated p_valid;
  - empirical precision gate: threshold at which the calibration set reaches
    a target precision (the conformal-style guarantee: under exchangeability
    the accepted set holds the error rate; with n=31 demo edges this is a
    small-sample estimate, reported honestly as such);
  - cost-sensitive decision (3:1 FP:FN) and audience-aware gating
    (patient vs researcher);
  - multi-hop path propagation: p_path = prod(p_edge) * (1 - max_contra),
    with weakest-link attribution.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path

import os as _os
DATA_DIR = Path(_os.environ.get("EMMATICS_DATA_DIR", _os.environ.get("ATLAS_DATA_DIR") or Path(__file__).resolve().parents[3] / "data"))

# ---- expert policy constants (Section C) ----
ESTABLISHED_THRESHOLD = 0.90   # Q14: patient-facing "established"
HIDE_THRESHOLD = 0.40          # Q15: hide below this in patient view
FP_COST = 3.0                  # Q17: false positive ~3x worse than false negative
FN_COST = 1.0
COST_OPTIMAL_THRESHOLD = FP_COST / (FP_COST + FN_COST)  # 0.75: show iff p > 0.75
CAVEAT_LANGUAGE = ("Early or limited evidence, not yet confirmed. "
                   "Discuss with your doctor before making any decisions based on this.")  # Q16
CONTRADICTED_WARN = 0.30       # Q18: at/above this, contradicting paper must surface

# v1 ladder index (hypothesis 0..clinical 3); v2 splits supported into
# model-only / patient (hypothesis 0..clinical 4). Replicated bar:
# v1 expected >= 2.0, v2 expected >= 3.0.
REPLICATED_BAR = {"edge-validate-v1": 2.0, "edge-validate-v2": 3.0}


# ---- expert targets ----

@lru_cache(maxsize=1)
def expert_targets() -> dict:
    """edge_id -> {label, soft_target, verdict, contested, ...}.

    Prefers data/expert_labels.json (domain-expert overlay); falls back to
    data/gold_labels.json hard labels when the overlay is absent.
    """
    exp = DATA_DIR / "expert_labels.json"
    if exp.exists():
        labels = json.loads(exp.read_text())["labels"]
        return {e["edge_id"]: e for e in labels}
    gold = json.loads((DATA_DIR / "gold_labels.json").read_text())["labels"]
    return {g["edge_id"]: {"label": g["label"], "soft_target": float(g["label"]),
                           "verdict": None, "contested": False} for g in gold}


def contested_ids() -> list[str]:
    return [eid for eid, e in expert_targets().items() if e.get("contested")]


@lru_cache(maxsize=1)
def trap_suite() -> list[dict]:
    f = DATA_DIR / "trap_suite.json"
    if not f.exists():
        return []
    return json.loads(f.read_text())["traps"]


# ---- temperature scaling ----

def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _logit(p: float) -> float:
    p = min(0.999, max(0.001, p))
    return math.log(p / (1.0 - p))


def calibrate_p(p: float, temperature: float) -> float:
    """Apply temperature scaling to a binary probability."""
    if temperature <= 0:
        return p
    return _sigmoid(_logit(p) / temperature)


def fit_temperature(probs: dict[str, float], targets: dict[str, float] | None = None) -> float:
    """Grid-search the NLL-optimal temperature on (soft) targets.

    Uses expert soft targets for contested edges (a judge that says 0.9 on a
    0.5-soft edge *should* be penalized: the expert genuinely disagrees).
    """
    tgts = targets or {eid: e["soft_target"] for eid, e in expert_targets().items()}
    pairs = [(probs[eid], tgts[eid]) for eid in probs if eid in tgts]
    if not pairs:
        return 1.0
    best_t, best_nll = 1.0, float("inf")
    t = 0.1
    while t <= 5.0:
        nll = 0.0
        for p, y in pairs:
            q = calibrate_p(p, t)
            q = min(0.999, max(0.001, q))
            nll -= y * math.log(q) + (1.0 - y) * math.log(1.0 - q)
        if nll < best_nll:
            best_nll, best_t = nll, t
        t += 0.1
    return round(best_t, 1)


# ---- gating ----

def band(p_valid: float | None) -> str:
    """established / review / hidden under the expert 90/40 policy.

    None (curated annotation, no judgment) is its own band: curated edges
    are database facts, not hypotheses, so they never render as hidden.
    """
    if p_valid is None:
        return "curated"
    if p_valid >= ESTABLISHED_THRESHOLD:
        return "established"
    if p_valid >= HIDE_THRESHOLD:
        return "review"
    return "hidden"


def gate(edge_valid: float | None, contradicted: float | None = None,
         evidence_expected: float | None = None,
         pack_id: str = "edge-validate-v1",
         audience: str = "patient",
         provenance: str | None = None) -> dict:
    """Audience-aware gate for one edge.

    patient: established only at >=0.90 AND replicated evidence AND no
      serious contradiction; hidden below 0.40; middle band gets caveat.
    researcher: same bands, but solid-yet-contradicted edges show with a
      warning instead of suppressing (Q18).
    curated (provenance=curated, no judgment): always show — curated
      annotations are database facts, not model hypotheses.
    """
    if edge_valid is None:
        if provenance == "curated":
            return {"action": "show", "band": "curated",
                    "reason": "curated annotation from a source database; not a model hypothesis"}
        return {"action": "hidden", "band": "hidden", "reason": "no judgment available"}
    b = band(edge_valid)
    contra = contradicted or 0.0
    replicated = (evidence_expected is None or
                  evidence_expected >= REPLICATED_BAR.get(pack_id, 2.0))
    if audience == "researcher":
        if b == "established" and contra >= CONTRADICTED_WARN:
            return {"action": "show_with_warning", "band": b,
                    "reason": f"solid evidence but contradicted={contra:.2f}; contradicting paper attached",
                    "caveat": CAVEAT_LANGUAGE}
        if b == "established" and not replicated:
            return {"action": "show_with_warning", "band": "review",
                    "reason": "high p(valid) but evidence below replicated; needs human-grade confirmation",
                    "caveat": CAVEAT_LANGUAGE}
        if b == "established":
            return {"action": "show", "band": b, "reason": "established hypothesis"}
        if b == "review":
            return {"action": "show_hypothesis", "band": b,
                    "reason": "weak connection; useful for idea generation, not conclusions",
                    "caveat": CAVEAT_LANGUAGE}
        return {"action": "hidden", "band": b, "reason": f"p(valid)={edge_valid:.2f} below hide threshold"}
    # patient view: stricter
    if b == "established" and replicated and contra < CONTRADICTED_WARN:
        return {"action": "show", "band": b, "reason": "established: calibrated >=0.90 with replicated evidence"}
    if b == "established":
        return {"action": "suppress_pending", "band": "review",
                "reason": ("high p(valid) but "
                           + ("contradicting paper of comparable quality; suppressed until resolved" if contra >= CONTRADICTED_WARN else "evidence below replicated; needs confirmation")),
                "caveat": CAVEAT_LANGUAGE}
    if b == "review":
        return {"action": "show_hypothesis", "band": b,
                "reason": "early evidence only", "caveat": CAVEAT_LANGUAGE}
    return {"action": "hidden", "band": b, "reason": f"p(valid)={edge_valid:.2f} below hide threshold"}


def precision_gate(probs: dict[str, float], labels: dict[str, int],
                   target_precision: float = 0.90) -> dict:
    """Empirical threshold at which accepted edges reach target precision.

    Sort by p desc, walk down, report the highest threshold holding precision
    >= target. Honest small-sample version of a conformal selective gate:
    valid under exchangeability; with n=31 demo edges the threshold is an
    estimate, and the report says so.
    """
    pairs = sorted(((probs[e], labels[e]) for e in probs if e in labels),
                   key=lambda t: -t[0])
    if not pairs:
        return {"threshold": 1.0, "accepted": 0, "precision": None, "abstention_rate": 1.0}
    best = {"threshold": 1.01, "accepted": 0, "precision": None}
    tp = fp = 0
    for i, (p, y) in enumerate(pairs):
        tp += (y == 1)
        fp += (y == 0)
        prec = tp / (tp + fp)
        if prec >= target_precision:
            best = {"threshold": round(p, 3), "accepted": i + 1, "precision": round(prec, 3)}
    best["abstention_rate"] = round(1.0 - best["accepted"] / len(pairs), 3)
    best["n"] = len(pairs)
    best["target"] = target_precision
    return best


# ---- multi-hop path propagation ----

def path_confidence(edge_valids: list[float], contradicted: list[float] | None = None) -> dict:
    """Noisy-OR-style path score: chain is only as strong as its links.

    p_path = prod(p_edge) * (1 - max_contra). Returns the score plus the
    weakest-link index for UI attribution.
    """
    if not edge_valids:
        return {"p_path": None, "weakest_link": None}
    contra = max(contradicted) if contradicted else 0.0
    p_path = 1.0
    for p in edge_valids:
        p_path *= p
    p_path *= (1.0 - contra)
    weakest = min(range(len(edge_valids)), key=lambda i: edge_valids[i])
    return {"p_path": round(p_path, 3), "weakest_link": weakest,
            "weakest_p": round(edge_valids[weakest], 3),
            "max_contradicted": round(contra, 3)}


def cost_of_decisions(probs: dict[str, float], labels: dict[str, int],
                          threshold: float = 0.5) -> dict:
    """Expected expert-cost accounting: FP costs 3, FN costs 1 (Q17)."""
    fp = sum(1 for e, p in probs.items() if e in labels and p >= threshold and labels[e] == 0)
    fn = sum(1 for e, p in probs.items() if e in labels and p < threshold and labels[e] == 1)
    total = FP_COST * fp + FN_COST * fn
    n = sum(1 for e in probs if e in labels)
    return {"false_positives": fp, "false_negatives": fn,
            "total_cost": total, "cost_per_edge": round(total / n, 3) if n else None,
            "threshold": threshold, "fp_cost": FP_COST, "fn_cost": FN_COST, "n": n}
