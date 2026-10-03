#!/usr/bin/env python3
"""Re-judge every edge that has a state snippet using the real Laya model,
then write the results to data/laya_judgments_zeroshot.json for the eval
harness to compare against the stored (mock) judgments.

Usage (from repo root):
    backend/.venv/bin/pip install laya      # one-time, ~1.4 GB checkpoint on first run
    backend/.venv/bin/python scripts/judge_with_laya.py

Takes ~5 s for the 31 demo edges on an M-series Mac (152 ms/edge).
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

try:
    from laya import Router
except ImportError:
    sys.exit("laya is not installed. Run: backend/.venv/bin/pip install laya")


def main() -> None:
    router = Router(preload=False)
    packs = json.loads((DATA / "question_packs.json").read_text())["packs"]
    pack = packs["edge-validate-v1"]["questions"]
    graph = json.loads((DATA / "graph.json").read_text())
    nodes = {n["id"]: n for n in graph["nodes"]}
    judged = [e for e in graph["edges"] if e.get("state")]

    print(f"judging {len(judged)} edges with Laya...")
    results = {}
    t0 = time.time()
    for e in judged:
        src = nodes.get(e["source"], {}).get("name", e["source"])
        tgt = nodes.get(e["target"], {}).get("name", e["target"])
        state = (f"Claim: {src} --{e['rel_type']}--> {tgt}.\n"
                 f"Claim description: {e['description']}\nEvidence: {e['state']}")
        a = router.predict(state, pack)["answers"]
        results[e["id"]] = {"edge_valid": round(a["edge_valid"]["noul"], 4)}
    dt = time.time() - t0
    print(f"done in {dt:.1f}s ({dt / len(judged) * 1000:.0f} ms/edge)")

    out = {
        "_notice": ("Zero-shot judgments from convaiinnovations/laya over the demo edges, "
                    "produced by scripts/judge_with_laya.py. Regenerable; kept so evals can "
                    "compare judges without a GPU or model download."),
        "model": "convaiinnovations/laya",
        "question_pack": "edge-validate-v1",
        "judged_at": date.today().isoformat(),
        "judgments": results,
    }
    (DATA / "laya_judgments_zeroshot.json").write_text(json.dumps(out, indent=2))
    print(f"wrote {DATA / 'laya_judgments_zeroshot.json'}")


if __name__ == "__main__":
    main()
