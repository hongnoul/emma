#!/usr/bin/env python3
"""Smoke test: exercises every endpoint and the core user journey against
a running backend (default http://localhost:8000).

Usage:  python3 scripts/smoke_test.py
Exit 0 = all checks pass. No test framework needed.
"""
import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
failures = []


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=10) as r:
        return json.loads(r.read())


def check(name, cond):
    print(("PASS" if cond else "FAIL"), name)
    if not cond:
        failures.append(name)


# Maria's journey, end to end
results = get("/api/search?q=lysosomal")
check("search returns results", len(results) > 0)
check("search finds the disease", any(r["id"] == "DEMO-DIS-001" for r in results))

d = get("/api/diseases/DEMO-DIS-001")
check("disease detail has gene", any(g["name"] == "LYSA1" for g in d["genes"]))
check("disease detail has phenotypes", len(d["phenotypes"]) >= 3)
check("disease detail has assets", len(d["assets"]) >= 1)

rel = get("/api/diseases/DEMO-DIS-001/related")
check("related diseases found", len(rel) >= 2)
check("related sorted by p(valid)", all(rel[i]["similarity"] >= rel[i+1]["similarity"] for i in range(len(rel)-1)))
check("inferred edges flagged", any(r["connecting_edge"]["provenance"] == "inferred" for r in rel))

c = get("/api/connections/DEMO-DIS-001/DEMO-DIS-002")
names = [s["node"]["name"] for s in c["path"]]
check("connection path is mechanistic (gene->pathway->gene)",
      "LYSA1" in names and "LYSB2" in names and any("pathway" in n.lower() for n in names))
check("connection separates known/inferred", len(c["known"]) > 0 and len(c["inferred"]) > 0)

g = get("/api/diseases/DEMO-DIS-001/graph?depth=2")
check("subgraph nonempty", len(g["nodes"]) > 10 and len(g["edges"]) > 10)
check("subgraph edges reference included nodes",
      {e["source"] for e in g["edges"]} <= {n["id"] for n in g["nodes"]})

opp = get("/api/diseases/DEMO-DIS-001/opportunities")
check("opportunities derived", len(opp) >= 3)
check("opportunities carry disclaimer", all("expert validation" in o["disclaimer"] for o in opp))
check("opportunities cite evidence edges", all(o["evidence_edge_ids"] for o in opp))

# Evidence integrity
ev = get("/api/diseases/DEMO-DIS-001/evidence")
judged = [e for e in ev if e.get("edge_valid") is not None]
check("judged edges have full decision block",
      all(e.get("rel_probs") and e.get("evidence_level") and e.get("state") and e.get("decision_meta") for e in judged))
check("rel_probs sum to ~1",
      all(abs(sum(e["rel_probs"].values()) - 1) < 0.02 for e in judged))
trap = get("/api/edges/DEMO-EDGE-011")  # legacy wrong gene link
check("trap edge carries contradictory evidence", len(trap["contradictory_evidence"]) > 0)

# Decision + evals
j = get("/api/edges/DEMO-EDGE-001/judge")
check("judge endpoint returns decision block", j.get("edge_valid") is not None)
r = get("/api/evals")
check("evals: n>0 and metrics in range",
      r["n"] > 0 and 0 <= r["accuracy"] <= 1 and 0 <= r["brier"] <= 1 and 0 <= r["ece"] <= 1)
packs = get("/api/question-packs")
check("question packs served", "edge-validate-v1" in packs)

print(f"\n{len(failures)} failures" if failures else "\nAll checks passed.")
sys.exit(1 if failures else 0)
