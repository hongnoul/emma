"""Benchmark history: record eval runs over time and diff them.

Each record is a full snapshot of one `run_evals(judge)` result plus the
per-edge probabilities behind it, stored as
`data/benchmarks/<UTC-timestamp>_<judge>.json`:

    {
      "run_id": "20261004T031500Z_openai-v2",
      "recorded_at": "2026-10-04T03:15:00Z",
      "judge": "openai-v2", "generation_id": "demo", "git_sha": "abc1234",
      "metrics": {"n": 31, "accuracy": 0.968, "brier": 0.035, ...},
      "probs": {"DEMO-EDGE-001": 1.0, ...},
      "trap_results": [...], "contested": {...}, ...
    }

Diffs answer two questions:
  - run-vs-run: did the judge get better/worse since last week?
    (`diff_runs(from_id, to_id)`)
  - judge-vs-judge: how does OpenAI compare to Laya right now?
    (`diff_live(judge_a, judge_b)` — snapshots live evals, no files needed)

Metric deltas use (to − from); for Brier/ECE/cost negative is better.
Trap flips and top per-edge probability movers are listed explicitly so a
diff reads as "what changed", not just numbers.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import os as _os
DATA_DIR = Path(_os.environ.get("EMMATICS_DATA_DIR", _os.environ.get("ATLAS_DATA_DIR") or Path(__file__).resolve().parents[3] / "data"))
BENCH_DIR = DATA_DIR / "benchmarks"

# Metrics where lower is better (sign note in diffs).
LOWER_BETTER = {"brier", "brier_soft", "brier_calibrated", "ece",
                "cost_0_5", "cost_0_75", "abstention_rate", "temperature"}
HIGHER_BETTER = {"accuracy", "trap_pass_rate", "precision", "accepted"}


def _git_sha() -> str | None:
    try:
        r = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, timeout=5,
                           cwd=Path(__file__).resolve().parents[3])
        return r.stdout.strip() or None
    except Exception:
        return None


def _prob_map(judge: str) -> dict[str, float]:
    """edge_id -> p(valid) for a judge, same source as run_evals."""
    from .evals import _expert_labels, _stored_probs, _JUDGMENT_FILES
    from .graph_store import get_store
    hard, _, _ = _expert_labels()
    if judge in _JUDGMENT_FILES:
        all_probs = _stored_probs(judge) or {}
        return {eid: all_probs[eid] for eid in hard if eid in all_probs}
    store = get_store()
    return {eid: store.edges[eid].edge_valid for eid in hard
            if eid in store.edges and store.edges[eid].edge_valid is not None}


def snapshot(judge: str) -> dict:
    """Live snapshot of one judge: full metrics + per-edge probs."""
    from .evals import expert_extra, run_evals
    from .graph_store import get_store
    r = run_evals(judge)
    extra = expert_extra(r)
    probs = _prob_map(judge)
    now = datetime.now(timezone.utc)
    return {
        "run_id": now.strftime("%Y%m%dT%H%M%SZ") + f"_{judge}",
        "recorded_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "judge": judge,
        "generation_id": get_store().generation,
        "git_sha": _git_sha(),
        "metrics": {
            "n": r.n, "accuracy": r.accuracy, "brier": r.brier,
            "ece": r.ece,
            "brier_soft": extra.get("brier_soft"),
            "temperature": extra.get("temperature"),
            "brier_calibrated": extra.get("brier_calibrated"),
            "trap_pass_rate": extra.get("trap_pass_rate"),
            "precision": (extra.get("precision_gate") or {}).get("precision"),
            "accepted": (extra.get("precision_gate") or {}).get("accepted"),
            "abstention_rate": (extra.get("precision_gate") or {}).get("abstention_rate"),
            "gate_threshold": (extra.get("precision_gate") or {}).get("threshold"),
            "cost_0_5": (extra.get("cost_at_0_5") or {}).get("total_cost"),
            "cost_0_75": (extra.get("cost_at_0_75") or {}).get("total_cost"),
        },
        "bins": r.bins,
        "notes": r.notes,
        "precision_gate": extra.get("precision_gate"),
        "cost_at_0_5": extra.get("cost_at_0_5"),
        "cost_at_0_75": extra.get("cost_at_0_75"),
        "trap_results": extra.get("trap_results", []),
        "contested": extra.get("contested", {}),
        "probs": {eid: round(p, 4) for eid, p in probs.items()},
    }


def record(judge: str, note: str = "") -> dict:
    """Snapshot one judge and persist it. Returns the stored record."""
    BENCH_DIR.mkdir(parents=True, exist_ok=True)
    rec = snapshot(judge)
    if note:
        rec["note"] = note
    (BENCH_DIR / f"{rec['run_id']}.json").write_text(json.dumps(rec, indent=2))
    return rec


def record_all(note: str = "") -> list[dict]:
    from .evals import _JUDGMENT_FILES
    out = []
    for judge in ["mock", *sorted(_JUDGMENT_FILES)]:
        try:
            out.append(record(judge, note))
        except Exception as e:  # one missing judgment file skips, rest record
            out.append({"judge": judge, "error": str(e)})
    return out


def list_runs(judge: str | None = None, limit: int = 50) -> list[dict]:
    """Newest-first run summaries (metadata + metrics, no per-edge probs)."""
    if not BENCH_DIR.exists():
        return []
    files = sorted(BENCH_DIR.glob("*.json"), reverse=True)
    out = []
    for f in files:
        try:
            rec = json.loads(f.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if judge and rec.get("judge") != judge:
            continue
        out.append({k: rec.get(k) for k in
                    ("run_id", "recorded_at", "judge", "generation_id",
                     "git_sha", "note", "metrics")})
        if len(out) >= limit:
            break
    return out


def load_run(run_id: str) -> dict | None:
    f = BENCH_DIR / f"{run_id}.json"
    if not f.exists():
        return None
    return json.loads(f.read_text())


def _metric_deltas(a: dict, b: dict) -> list[dict]:
    """Delta rows for shared numeric metrics (b − a)."""
    rows = []
    keys = [k for k in (a.get("metrics") or {}) if k in (b.get("metrics") or {})]
    for k in keys:
        va, vb = a["metrics"][k], b["metrics"][k]
        if not isinstance(va, (int, float)) or not isinstance(vb, (int, float)):
            continue
        d = round(vb - va, 4)
        better = (d < 0) if k in LOWER_BETTER else (d > 0) if k in HIGHER_BETTER else None
        rows.append({"metric": k, "from": va, "to": vb, "delta": d,
                     "better": better,
                     "lower_is_better": k in LOWER_BETTER})
    return rows


def _trap_flips(a: dict, b: dict) -> list[dict]:
    ra = {t["edge_id"]: t["passed"] for t in a.get("trap_results", [])}
    rb = {t["edge_id"]: t["passed"] for t in b.get("trap_results", [])}
    flips = []
    for eid in sorted(set(ra) | set(rb)):
        pa, pb = ra.get(eid), rb.get(eid)
        if pa is not None and pb is not None and pa != pb:
            flips.append({"edge_id": eid,
                          "from": "passed" if pa else "failed",
                          "to": "passed" if pb else "failed",
                          "fixed": bool(pb and not pa)})
    return flips


def _prob_movers(a: dict, b: dict, top: int = 10) -> list[dict]:
    pa, pb = a.get("probs", {}), b.get("probs", {})
    movers = [{"edge_id": eid, "from": pa[eid], "to": pb[eid],
               "delta": round(pb[eid] - pa[eid], 4)}
              for eid in pa if eid in pb and pa[eid] != pb[eid]]
    movers.sort(key=lambda r: -abs(r["delta"]))
    return movers[:top]


def diff_records(a: dict, b: dict) -> dict:
    """Diff two records (stored or live snapshots). b is 'to'."""
    return {
        "from": {k: a.get(k) for k in ("run_id", "recorded_at", "judge", "generation_id", "git_sha", "note")},
        "to": {k: b.get(k) for k in ("run_id", "recorded_at", "judge", "generation_id", "git_sha", "note")},
        "same_judge": a.get("judge") == b.get("judge"),
        "same_generation": a.get("generation_id") == b.get("generation_id"),
        "metric_deltas": _metric_deltas(a, b),
        "trap_flips": _trap_flips(a, b),
        "top_movers": _prob_movers(a, b),
        "n_edges_compared": len(set(a.get("probs", {})) & set(b.get("probs", {}))),
    }


def diff_runs(from_id: str, to_id: str) -> dict | None:
    a, b = load_run(from_id), load_run(to_id)
    if a is None or b is None:
        return None
    return diff_records(a, b)


def diff_live(judge_a: str, judge_b: str) -> dict:
    """Judge-vs-judge right now (no files written)."""
    return diff_records(snapshot(judge_a), snapshot(judge_b))
