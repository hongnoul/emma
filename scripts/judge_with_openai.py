#!/usr/bin/env python3
"""Re-judge every demo edge that has a state snippet using the OpenAI
logprobs judge, then write the results to data/openai_judgments_zeroshot.json
for the eval harness (GET /api/evals?judge=openai) to compare against the
stored (mock) and Laya judgments.

The challenge brief requires leveraging OpenAI's models or tools to win the
track; this makes the calibrated-judge seam OpenAI-backed.

Usage (from repo root):
    export OPENAI_API_KEY=sk-...        # or rely on ~/.codex/auth.json
    python3 scripts/judge_with_openai.py [--model gpt-4o-mini] [--budget 5.0]

Edges are judged concurrently (4 questions x 31 demo edges = 124 single-token
calls, roughly a cent on gpt-4o-mini). Spend is estimated from usage and the
run aborts if it crosses the budget.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "backend"))

from app.services.openai_judge import OpenAIJudge, BudgetExceeded, SPEND  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None, help="override ATLAS_OPENAI_MODEL")
    ap.add_argument("--budget", type=float, default=None, help="spend cap in USD")
    ap.add_argument("--graph", default="graph.json", help="graph file in data/")
    ap.add_argument("--pack", default="edge-validate-v1", help="question pack id")
    ap.add_argument("--out", default=None, help="output file in data/ (default <judge>_judgments_zeroshot[_v2].json)")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    judge = OpenAIJudge(model=args.model, budget_usd=args.budget)
    packs = json.loads((DATA / "question_packs.json").read_text())["packs"]
    pack = packs[args.pack]["questions"]
    graph = json.loads((DATA / args.graph).read_text())
    nodes = {n["id"]: n for n in graph["nodes"]}
    judged = [e for e in graph["edges"] if e.get("state")]

    print(f"judging {len(judged)} edges with OpenAI ({judge.model}), "
          f"budget ${judge.budget:.2f}...")

    def one(e):
        src = nodes.get(e["source"], {}).get("name", e["source"])
        tgt = nodes.get(e["target"], {}).get("name", e["target"])
        state = (f"Claim: {src} --{e['rel_type']}--> {tgt}.\n"
                 f"Claim description: {e['description']}\nEvidence: {e['state']}")
        a = judge.predict(state, pack)["answers"]
        ss = a.get("superseded", {}).get("noul")
        lv = a["evidence_level"]["probabilities"]
        rec = {"edge_valid": round(a["edge_valid"]["noul"], 4)}
        if ss is not None:
            rec["superseded"] = round(ss, 4)
        rec["evidence_level"] = {kk: round(vv, 4) for kk, vv in lv.items()}
        rec["contradicted"] = round(a["contradicted"]["noul"], 4)
        return e["id"], rec

    results = {}
    t0 = time.time()
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            for eid, r in ex.map(one, judged):
                results[eid] = r
    except BudgetExceeded as e:
        print(f"ABORTED: {e}")
        if not results:
            sys.exit(1)
        print(f"writing the {len(results)} judgments completed before the cap...")
    dt = time.time() - t0
    n = max(len(results), 1)
    print(f"done in {dt:.1f}s ({dt / n * 1000:.0f} ms/edge), "
          f"estimated spend ${SPEND.usd:.4f} over {SPEND.calls} calls")

    out = {
        "_notice": ("Zero-shot judgments from the OpenAI logprobs judge over the demo edges, "
                    "produced by scripts/judge_with_openai.py. Regenerable; kept so evals can "
                    "compare judges without an API key."),
        "model": f"openai/{judge.model}",
        "question_pack": args.pack,
        "judged_at": date.today().isoformat(),
        "estimated_cost_usd": round(SPEND.usd, 4),
        "judgments": results,
    }
    out_name = args.out or ("openai_judgments_zeroshot.json" if args.pack == "edge-validate-v1" else "openai_judgments_v2.json")
    (DATA / out_name).write_text(json.dumps(out, indent=2))
    print(f"wrote {DATA / out_name}")


if __name__ == "__main__":
    main()
