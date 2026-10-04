#!/usr/bin/env python3
"""Record benchmark snapshots for judges, print a summary table + diffs.

Usage (from repo root):
    backend/.venv/bin/python scripts/record_benchmarks.py [--note TEXT] [--judges mock,openai-v2]

Snapshots every judge (default: all five) into data/benchmarks/, then prints
the metric table and the openai-vs-laya + v1-vs-v2 diffs. Commit the new
files to keep history: git add data/benchmarks/.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services import benchmarks as bench  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--note", default="", help="annotation stored on each run")
    ap.add_argument("--judges", default="mock,laya,openai,laya-v2,openai-v2",
                    help="comma-separated subset to record")
    args = ap.parse_args()

    recs = []
    for j in [x.strip() for x in args.judges.split(",") if x.strip()]:
        try:
            r = bench.record(j, args.note)
            recs.append(r)
            m = r["metrics"]
            print(f"{r['run_id']}: acc={m['accuracy']} brier={m['brier']} "
                  f"ece={m['ece']} traps={m['trap_pass_rate']} cost={m['cost_0_5']}")
        except Exception as e:
            print(f"{j}: SKIP ({e})")
    if not recs:
        sys.exit("nothing recorded")

    print("\n-- diff: openai vs laya (live) --")
    try:
        d = bench.diff_live("openai", "laya")
        for row in d["metric_deltas"]:
            print(f"  {row['metric']}: {row['from']} -> {row['to']} "
                  f"(delta {row['delta']:+}, better={row['better']})")
        for f in d["trap_flips"]:
            print(f"  trap {f['edge_id']}: {f['from']} -> {f['to']}")
    except Exception as e:
        print(f"  SKIP ({e})")

    print(f"\nwrote {len(recs)} runs to data/benchmarks/ "
          f"(git add data/benchmarks/ to keep history)")


if __name__ == "__main__":
    main()
