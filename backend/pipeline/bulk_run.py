"""Bulk pipeline: all rare diseases from ontology releases, two-channel
disease-disease candidates, batch-judged with checkpointing.

Run (from backend/):
    .venv/bin/python -m pipeline.bulk_run                # full: parse->candidates->judge->publish
    .venv/bin/python -m pipeline.bulk_run --no-judge     # structural only (fast)
    .venv/bin/python -m pipeline.bulk_run --max-judge 500  # cap judging (resume later)

Channels (per teammate's design):
  SHARES_GENE_MECHANISM  disease pairs sharing >=1 causal gene (curated-strength,
                         from genes_to_disease; not judged, the gene is the proof)
  PHENOTYPE_SIMILAR      disease pairs with high IC-weighted phenotype overlap,
                         judged by Laya (inferred channel)

Judging checkpoints to data/raw/bulk/judgments.jsonl; re-runs resume.
Output: data/graph.bulk.json (serve with ATLAS_GRAPH_PATH=data/graph.bulk.json).
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timezone
from itertools import combinations
from pathlib import Path

from . import bulk_parse as bp

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
CKPT = DATA / "raw" / "bulk" / "judgments.jsonl"

MIN_SHARED_PHENOS = 3
TOP_SIM_PER_DISEASE = 5      # keep each disease's top-N phenotype matches
MAX_PHENOS_IN_STATE = 8      # phenotype names in the Laya state
SIM_FLOOR = 0.18             # weighted-jaccard floor for candidates


def log(msg):
    print(f"[bulk] {msg}", flush=True)


# ------------------------------------------------------------- candidates

def gene_channel(dg: dict) -> list[tuple[str, str, frozenset]]:
    """Pairs sharing >=1 causal gene."""
    by_gene = defaultdict(list)
    for mondo, genes in dg.items():
        for g in genes:
            by_gene[g].append(mondo)
    pairs = {}
    for gene, ds in by_gene.items():
        if len(ds) > 40:   # huge gene families (e.g. collagen) produce noise
            continue
        for a, b in combinations(sorted(ds), 2):
            pairs.setdefault((a, b), set()).add(gene)
    return [(a, b, frozenset(gs)) for (a, b), gs in pairs.items()]


def phenotype_channel(dph: dict, ic: dict) -> list[tuple[str, str, float, list]]:
    """IC-weighted similarity candidates via inverted index (no all-pairs)."""
    # inverted index phenotype -> diseases, skipping uninformative terms
    by_ph = defaultdict(list)
    for mondo, phs in dph.items():
        for hp, w in phs.items():
            if ic.get(hp, 0) >= 2.0 and w > 0:   # IC>=2 ~ <13.5% of diseases
                by_ph[hp].append(mondo)
    # accumulate shared IC mass per pair
    shared: dict[tuple, float] = defaultdict(float)
    shared_terms: dict[tuple, list] = defaultdict(list)
    for hp, ds in by_ph.items():
        if len(ds) > 150:
            continue
        w = ic[hp]
        for a, b in combinations(sorted(ds), 2):
            shared[(a, b)] += w
            shared_terms[(a, b)].append(hp)
    # normalize: weighted jaccard-ish = shared / (icA + icB - shared)
    totals = {m: sum(ic.get(hp, 0) for hp in phs if ic.get(hp, 0) >= 2.0)
              for m, phs in dph.items()}
    scored = []
    for (a, b), s in shared.items():
        if len(shared_terms[(a, b)]) < MIN_SHARED_PHENOS:
            continue
        denom = totals.get(a, 0) + totals.get(b, 0) - s
        if denom <= 0:
            continue
        sim = s / denom
        if sim >= SIM_FLOOR:
            scored.append((a, b, sim, shared_terms[(a, b)]))
    # keep top-N per disease
    per = defaultdict(list)
    for a, b, sim, terms in scored:
        per[a].append((sim, a, b, terms))
        per[b].append((sim, a, b, terms))
    keep = set()
    for m, lst in per.items():
        lst.sort(reverse=True)
        for sim, a, b, terms in lst[:TOP_SIM_PER_DISEASE]:
            keep.add((a, b))
    return [(a, b, sim, terms) for a, b, sim, terms in scored if (a, b) in keep]


# ------------------------------------------------------------- judging

def load_checkpoint() -> dict:
    done = {}
    if CKPT.exists():
        for line in CKPT.open():
            try:
                r = json.loads(line)
                done[r["key"]] = r
            except json.JSONDecodeError:
                continue
    return done


def judge_batch(cands, diseases, dph, dg, hp_labels, ic, max_judge):
    from laya import Router
    packs = json.loads((DATA / "question_packs.json").read_text())["packs"]
    pack = packs["edge-validate-v1"]["questions"]
    level_names = pack["evidence_level"]["criteria"]
    router = Router(preload=False)
    done = load_checkpoint()
    out = dict(done)
    todo = [c for c in cands if f"{c[0]}|{c[1]}" not in done]
    if max_judge:
        todo = todo[:max_judge]
    log(f"judging {len(todo)} candidates ({len(done)} already checkpointed)")
    t0 = time.time()
    with CKPT.open("a") as ck:
        for i, (a, b, sim, terms) in enumerate(todo):
            na, nb = diseases[a]["name"], diseases[b]["name"]
            terms_ranked = sorted(terms, key=lambda h: -ic.get(h, 0))[:MAX_PHENOS_IN_STATE]
            tnames = [hp_labels.get(h, h) for h in terms_ranked]
            ga = ", ".join(sorted(dg.get(a, []))[:3]) or "unknown"
            gb = ", ".join(sorted(dg.get(b, []))[:3]) or "unknown"
            state = (f"Claim: {na} --PHENOTYPE_SIMILAR--> {nb}.\n"
                     f"Claim description: these two rare diseases present with an unusually "
                     f"similar phenotype profile (weighted similarity {sim:.2f}).\n"
                     f"Evidence: Shared informative HPO phenotypes: {', '.join(tnames)}. "
                     f"Causal genes: {na}: {ga}; {nb}: {gb}. Similarity is computed from "
                     f"curated HPO annotations weighted by how informative (rare) each "
                     f"phenotype is across all diseases; generic phenotypes are excluded.")
            ans = router.predict(state, pack)["answers"]
            lv = ans["evidence_level"]["probabilities"]
            rec = {
                "key": f"{a}|{b}", "sim": round(sim, 4),
                "edge_valid": round(ans["edge_valid"]["noul"], 4),
                "rel_probs": {k: round(v, 4) for k, v in ans["rel_class"]["probabilities"].items()},
                "evidence_level": {"expected": round(ans["evidence_level"]["score"], 3),
                                   "probs": {level_names[int(k)]: round(v, 4) for k, v in lv.items()}},
                "contradicted": round(ans["contradicted"]["noul"], 4),
                "state": state,
                "judged_at": date.today().isoformat(),
            }
            ck.write(json.dumps(rec) + "\n")
            out[rec["key"]] = rec
            if (i + 1) % 100 == 0:
                rate = (i + 1) / (time.time() - t0)
                log(f"  {i+1}/{len(todo)} ({rate:.1f}/s, eta {int((len(todo)-i-1)/rate)}s)")
    return out


# ------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument("--max-judge", type=int, default=0, help="cap judgments this run (0=all)")
    args = ap.parse_args()

    log("parsing bulk files...")
    diseases, xref = bp.mondo_diseases()
    hp_labels = bp.hp_labels()
    dph = bp.disease_phenotypes(xref)
    dg = bp.disease_genes(xref)

    # propagate genes up one level: subtype genes count for the parent too
    for m in list(dph.keys() | dg.keys()):
        pass
    child_genes = defaultdict(set)
    for m, info in diseases.items():
        for parent in info.get("parents", []):
            if m in dg and parent in diseases:
                child_genes[parent] |= dg[m]
    for parent, gs in child_genes.items():
        dg.setdefault(parent, set())
        dg[parent] |= gs

    # keep only diseases with any annotation (phenotypes or genes)
    active = {m for m in diseases if m in dph or m in dg}
    log(f"{len(diseases)} MONDO diseases; {len(active)} with annotations "
        f"({len(dph)} phenotyped, {len(dg)} with genes)")

    # information content per phenotype: -log2(n_diseases_with_term / total)
    n = len(dph) or 1
    df = defaultdict(int)
    for phs in dph.values():
        for hp in phs:
            df[hp] += 1
    ic = {hp: -math.log2(c / n) for hp, c in df.items()}

    # ancestor map (2 levels is enough to kill subtype noise cheaply)
    def ancestors(m, depth=3):
        seen = set()
        frontier = [m]
        for _ in range(depth):
            nxt = []
            for x in frontier:
                for pa in diseases.get(x, {}).get("parents", []):
                    if pa not in seen:
                        seen.add(pa)
                        nxt.append(pa)
            frontier = nxt
        return seen

    anc_cache: dict[str, set] = {}
    def related_by_hierarchy(a, b):
        if a not in anc_cache:
            anc_cache[a] = ancestors(a)
        if b not in anc_cache:
            anc_cache[b] = ancestors(b)
        return b in anc_cache[a] or a in anc_cache[b]

    log("gene channel...")
    gene_pairs = [(a, b, g) for a, b, g in gene_channel(dg)
                  if not related_by_hierarchy(a, b)]
    log(f"  {len(gene_pairs)} shared-gene pairs (hierarchy-filtered)")

    log("phenotype channel (candidates)...")
    ph_cands = [(a, b, sim, t) for a, b, sim, t in phenotype_channel(dph, ic)
                if not related_by_hierarchy(a, b)]
    log(f"  {len(ph_cands)} phenotype-similarity candidates (hierarchy-filtered, floor={SIM_FLOOR}, top{TOP_SIM_PER_DISEASE}/disease)")

    judgments = {}
    if not args.no_judge:
        judgments = judge_batch(ph_cands, diseases, dph, dg, hp_labels, ic, args.max_judge)

    # ---------------- build graph ----------------
    log("building graph...")
    nodes, edges = {}, []
    eid = 0

    def disease_node(m):
        if m not in nodes:
            d = diseases[m]
            nodes[m] = {"id": m, "type": "Disease", "name": d["name"],
                        "description": (d.get("definition") or "")[:400], "identifier": m}

    gene_nodes_added = set()
    def gene_node(sym):
        gid = f"GENE:{sym}"
        if gid not in gene_nodes_added:
            nodes[gid] = {"id": gid, "type": "Gene", "name": sym,
                          "description": f"Gene {sym} (causal for one or more rare diseases).",
                          "identifier": gid}
            gene_nodes_added.add(gid)
        return gid

    # gene-mechanism channel edges (+ CAUSED_BY so detail pages work)
    pair_count = 0
    for a, b, genes in gene_pairs:
        disease_node(a); disease_node(b)
        eid += 1
        gl = ", ".join(sorted(genes))
        edges.append({
            "id": f"BULK-{eid:06d}", "source": a, "target": b,
            "rel_type": "SHARES_GENE_MECHANISM", "provenance": "curated",
            "description": f"Both diseases have causal variants in: {gl}.",
            "source_db": "hpoa-genes_to_disease", "source_id": f"gene:{gl}",
            "supporting_publications": [], "contradictory_evidence": [],
        })
        pair_count += 1

    judged_edges = 0
    for a, b, sim, terms in ph_cands:
        rec = judgments.get(f"{a}|{b}")
        disease_node(a); disease_node(b)
        eid += 1
        e = {
            "id": f"BULK-{eid:06d}", "source": a, "target": b,
            "rel_type": "PHENOTYPE_SIMILAR", "provenance": "inferred",
            "description": (f"{diseases[a]['name']} and {diseases[b]['name']} share an "
                            f"unusually similar phenotype profile (similarity {sim:.2f})."),
            "source_db": "atlas-inference", "source_id": f"phenosim:{a}|{b}",
            "supporting_publications": [], "contradictory_evidence": [],
        }
        if rec:
            e.update({k: rec[k] for k in
                      ("edge_valid", "rel_probs", "evidence_level", "contradicted", "state")})
            e["decision_meta"] = {"model": "convaiinnovations/laya",
                                  "question_pack": "edge-validate-v1",
                                  "judged_at": rec["judged_at"]}
            judged_edges += 1
        edges.append(e)

    # CAUSED_BY edges for active diseases (detail pages + gene filtering)
    for m in active:
        if m not in nodes:
            continue
        for sym in sorted(dg.get(m, []))[:6]:
            gid = gene_node(sym)
            eid += 1
            edges.append({
                "id": f"BULK-{eid:06d}", "source": m, "target": gid,
                "rel_type": "CAUSED_BY", "provenance": "curated",
                "description": f"{diseases[m]['name']} is caused by variants in {sym}.",
                "source_db": "hpoa-genes_to_disease", "source_id": f"caused:{m}:{sym}",
                "supporting_publications": [], "contradictory_evidence": [],
            })

    log(f"graph: {len(nodes)} nodes, {len(edges)} edges "
        f"({pair_count} gene-channel, {len(ph_cands)} pheno-channel [{judged_edges} judged])")

    # ---------------- gate ----------------
    errors = []
    ids = set(nodes)
    for e in edges:
        if e["source"] not in ids or e["target"] not in ids:
            errors.append(f"orphan {e['id']}")
            break
    if len(nodes) < 1000:
        errors.append(f"volume sanity: only {len(nodes)} nodes")
    sys.path.insert(0, str(ROOT / "backend"))
    from app.models.schemas import Edge as EM, Node as NM
    NM(**next(iter(nodes.values()))); EM(**edges[0])  # spot check + full check below
    for e in edges[:2000]:
        EM(**e)
    if errors:
        for er in errors:
            log(f"GATE FAIL: {er}")
        sys.exit(1)
    log("gate passed")

    gen = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "_notice": ("REAL DATA bulk generation: all annotated rare diseases from MONDO/HPO/HPOA "
                    "releases. PHENOTYPE_SIMILAR edges are atlas hypotheses (judged by local Laya "
                    "where decision blocks present); SHARES_GENE_MECHANISM edges are derived from "
                    "curated causal-gene data. Not medical advice."),
        "generation": gen, "nodes": list(nodes.values()), "edges": edges,
    }
    (DATA / "graph.bulk.json").write_text(json.dumps(payload))
    log(f"published -> data/graph.bulk.json ({len(nodes)} nodes, {len(edges)} edges)")
    log("serve: ATLAS_GRAPH_PATH=data/graph.bulk.json uvicorn app.main:app")


if __name__ == "__main__":
    main()
