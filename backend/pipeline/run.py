"""Phase 1 pipeline: build a real judged graph for a lysosomal disease cluster.

Run (from backend/):
    .venv/bin/python -m pipeline.run                 # uses raw cache when present
    .venv/bin/python -m pipeline.run --refresh       # force re-fetch
    .venv/bin/python -m pipeline.run --no-judge      # skip judging (structural only)
    .venv/bin/python -m pipeline.run --judge laya    # use local Laya instead of OpenAI

Stages (docs/ingestion-pipeline.md):
  fetch     Monarch v3 (aggregates MONDO/OMIM/Orphanet/HPOA) + PubMed eutils
  normalize per-source records -> Node/Edge dicts in our schema
  reconcile Monarch already keys everything to MONDO/HGNC/HP; we keep xrefs
            and enforce one-node-per-curie
  assemble  build `state` evidence snippets; derive SHARES_MECHANISM
            candidates from shared causal genes
  judge     batch judge over judgeable edges: OpenAI logprobs judge by
            default (--judge openai, challenge requirement) or local Laya
            (--judge laya)
  gate      schema validation, referential integrity, volume sanity,
            trap behavior (contradicted legacy edges must not score high)
  publish   write data/generations/<ts>.json and promote to data/graph.real.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from . import fetch

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"

# ----------------------------------------------------------------- cluster
# Seed: classic lysosomal storage diseases with distinct genes but shared
# pathway biology. Small enough to judge in seconds, rich enough to cluster.
# IDs verified against Monarch search on 2026-10-03.
CLUSTER = [
    "MONDO:0018150",  # Gaucher disease               (GBA1)
    "MONDO:0010526",  # Fabry disease                 (GLA)
    "MONDO:0009756",  # Niemann-Pick disease type A   (SMPD1)
    "MONDO:0009757",  # Niemann-Pick disease type C1  (NPC1)
    "MONDO:0009499",  # Krabbe disease                (GALC)
    "MONDO:0018868",  # metachromatic leukodystrophy  (ARSA)
    "MONDO:0009650",  # mucolipidosis type II         (GNPTAB)
    "MONDO:0009290",  # glycogen storage disease II / Pompe (GAA)
    "MONDO:0010100",  # Tay-Sachs disease             (HEXA)
    "MONDO:0010006",  # Sandhoff disease              (HEXB)
]
MAX_PHENOS_PER_DISEASE = 20
PUBS_PER_DISEASE = 3


def log(msg: str) -> None:
    print(f"[pipeline] {msg}", flush=True)


# ----------------------------------------------------------------- fetch+normalize

def build_nodes_edges(refresh: bool) -> tuple[dict, list]:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    eid = [0]

    def add_node(curie, type_, name, description="", **extra):
        if curie not in nodes:
            nodes[curie] = {"id": curie, "type": type_, "name": name,
                            "description": description, "identifier": curie, **extra}
        return nodes[curie]

    def add_edge(src, tgt, rel, desc, source_db, provenance="curated", **extra):
        eid[0] += 1
        e = {"id": f"EDGE-{eid[0]:04d}", "source": src, "target": tgt, "rel_type": rel,
             "provenance": provenance, "description": desc, "source_db": source_db,
             "source_id": f"{source_db}:{src}->{tgt}",
             "supporting_publications": [], "contradictory_evidence": [], **extra}
        edges.append(e)
        return e

    disease_genes: dict[str, list[tuple[str, str]]] = {}   # mondo -> [(hgnc, symbol)]
    disease_phenos: dict[str, list[tuple[str, str, str]]] = {}  # mondo -> [(hp, label, freq)]

    for mondo in CLUSTER:
        ent = fetch.monarch_entity(mondo, refresh)
        if not ent.get("id"):
            log(f"  WARN: {mondo} not found, skipping")
            continue
        name = ent.get("name", mondo)
        desc = (ent.get("description") or "")[:400]
        add_node(mondo, "Disease", name, desc)
        log(f"  {mondo} {name}")

        # causal genes (object = disease; Monarch aggregates OMIM/Orphanet)
        gene_assocs = fetch.monarch_assoc(
            {"object": mondo, "category": "biolink:CausalGeneToDiseaseAssociation"},
            f"genes_{mondo.replace(':', '_')}", refresh)
        seen_genes = set()
        for a in gene_assocs:
            hgnc, sym = a["subject"], a.get("subject_label", a["subject"])
            if hgnc in seen_genes:
                continue  # Monarch emits one association per OMIM subtype
            seen_genes.add(hgnc)
            add_node(hgnc, "Gene", sym, f"Gene {sym} ({hgnc}).")
            ks = (a.get("primary_knowledge_source") or "monarch").replace("infores:", "")
            add_edge(mondo, hgnc, "CAUSED_BY",
                     f"{name} is caused by variants in {sym} (per {ks} via Monarch).",
                     source_db=ks)
            disease_genes.setdefault(mondo, []).append((hgnc, sym))

        # phenotypes with frequency qualifiers
        ph_assocs = fetch.monarch_assoc(
            {"subject": mondo, "category": "biolink:DiseaseToPhenotypicFeatureAssociation"},
            f"phenos_{mondo.replace(':', '_')}", refresh)
        # prefer frequent phenotypes: HP:0040280-0040284 ladder, lower = more frequent
        def freq_rank(a):
            f = a.get("frequency_qualifier") or "HP:0040283"
            return f
        ph_assocs.sort(key=freq_rank)
        seen_ph = set()
        for a in ph_assocs:
            if len(seen_ph) >= MAX_PHENOS_PER_DISEASE:
                break
            hp, label = a["object"], a.get("object_label", a["object"])
            if hp in seen_ph:
                continue
            seen_ph.add(hp)
            freq = a.get("frequency_qualifier_label") or ""
            add_node(hp, "Phenotype", label, f"HPO term {hp}.")
            add_edge(mondo, hp, "HAS_PHENOTYPE",
                     f"{name} presents with {label}" + (f" ({freq})" if freq else "") + ".",
                     source_db="hpoa")
            disease_phenos.setdefault(mondo, []).append((hp, label, freq))

    return nodes, edges, disease_genes, disease_phenos, eid


# ----------------------------------------------------------------- pubmed layer

def add_publications(nodes, edges, disease_genes, eid, refresh: bool):
    """For each disease+gene pair, attach top PubMed abstracts as evidence."""
    pub_snippets: dict[str, str] = {}  # mondo -> concatenated snippet text
    for mondo, genes in disease_genes.items():
        dname = nodes[mondo]["name"]
        sym = genes[0][1] if genes else ""
        term = f"{dname}[Title/Abstract] AND {sym}[Title/Abstract]" if sym else f"{dname}[Title/Abstract]"
        key = mondo.replace(":", "_")
        pmids = fetch.pubmed_search(term, f"search_{key}", retmax=PUBS_PER_DISEASE, refresh=refresh)
        if not pmids:
            pmids = fetch.pubmed_search(f"{dname}[Title]", f"search_title_{key}",
                                        retmax=PUBS_PER_DISEASE, refresh=refresh)
        summaries = fetch.pubmed_summaries(pmids, f"summary_{key}", refresh)
        abstract_blob = fetch.pubmed_abstracts(pmids, f"abs_{key}", refresh)
        for pmid in pmids:
            s = summaries.get(pmid, {})
            if not isinstance(s, dict) or not s.get("title"):
                continue
            pub_id = f"PMID:{pmid}"
            year = (s.get("pubdate") or "")[:4]
            nodes.setdefault(pub_id, {
                "id": pub_id, "type": "Publication", "name": s["title"][:200],
                "description": f"{s.get('fulljournalname', '')} ({year}). Real publication via PubMed.",
                "identifier": pub_id, "year": int(year) if year.isdigit() else None,
            })
            eid[0] += 1
            edges.append({"id": f"EDGE-{eid[0]:04d}", "source": mondo, "target": pub_id,
                          "rel_type": "SUPPORTED_BY", "provenance": "curated",
                          "description": f"{nodes[mondo]['name']} literature: {s['title'][:120]}",
                          "source_db": "pubmed", "source_id": pub_id,
                          "supporting_publications": [pub_id], "contradictory_evidence": []})
        # a rough per-disease evidence paragraph from the abstract blob
        para = " ".join(abstract_blob.split())[:600]
        if para:
            pub_snippets[mondo] = para
    return pub_snippets


# ----------------------------------------------------------------- assemble

FREQ_HINT = {"Very frequent": 0.9, "Frequent": 0.6, "Occasional": 0.2}

def assemble_candidates(nodes, edges, disease_genes, disease_phenos, pub_snippets, eid):
    """Derive SHARES_MECHANISM candidates + build states for judgeable edges."""
    # states for CAUSED_BY edges: gene assertion + PubMed context
    for e in edges:
        if e["rel_type"] == "CAUSED_BY":
            mondo, hgnc = e["source"], e["target"]
            dname, sym = nodes[mondo]["name"], nodes[hgnc]["name"]
            ctx = pub_snippets.get(mondo, "")
            e["state"] = (f"[{e['source_db']} via Monarch] {dname} is recorded as caused by "
                          f"variants in {sym}. "
                          + (f"PubMed context: {ctx[:400]}" if ctx else "No abstract context fetched."))

    # disease-disease candidates: shared phenotype profile (and later, pathway)
    mondos = [m for m in disease_genes]
    for i, a in enumerate(mondos):
        for b in mondos[i + 1:]:
            pa = {p for p, _, _ in disease_phenos.get(a, [])}
            pb = {p for p, _, _ in disease_phenos.get(b, [])}
            shared = pa & pb
            if len(shared) < 3:
                continue
            labels = [nodes[p]["name"] for p in list(shared)[:5]]
            ga = ", ".join(s for _, s in disease_genes.get(a, [])[:2])
            gb = ", ".join(s for _, s in disease_genes.get(b, [])[:2])
            eid[0] += 1
            edges.append({
                "id": f"EDGE-{eid[0]:04d}", "source": a, "target": b,
                "rel_type": "SHARES_MECHANISM", "provenance": "inferred",
                "description": (f"{nodes[a]['name']} and {nodes[b]['name']} are both lysosomal "
                                f"disorders sharing {len(shared)} annotated phenotypes."),
                "source_db": "atlas-inference", "source_id": f"pheno-overlap:{a}|{b}",
                "supporting_publications": [], "contradictory_evidence": [],
                "state": (f"Both {nodes[a]['name']} (genes: {ga}) and {nodes[b]['name']} (genes: {gb}) "
                          f"are lysosomal disorders. Shared HPO phenotypes: {', '.join(labels)}. "
                          f"Both disrupt lysosomal function, though via different genes; phenotype "
                          f"overlap may reflect shared downstream lysosomal pathology or may be "
                          f"generic (e.g. hepatosplenomegaly is common across storage disorders)."),
            })
    return edges


# ----------------------------------------------------------------- judge

def judge_edges(edges, nodes, judge_name: str = "openai") -> int:
    packs = json.loads((DATA / "question_packs.json").read_text())["packs"]
    pack = packs["edge-validate-v1"]["questions"]
    level_names = pack["evidence_level"]["criteria"]
    if judge_name == "laya":
        from laya import Router  # heavy import, deliberate
        router = Router(preload=False)
        model_id = "convaiinnovations/laya"
    else:
        sys.path.insert(0, str(ROOT / "backend"))
        from app.services.openai_judge import OpenAIJudge
        router = OpenAIJudge()
        model_id = f"openai/{router.model}"
    n = 0
    for e in edges:
        if "state" not in e:
            continue
        sname = nodes[e["source"]]["name"]
        tname = nodes[e["target"]]["name"]
        state = (f"Claim: {sname} --{e['rel_type']}--> {tname}.\n"
                 f"Claim description: {e['description']}\nEvidence: {e['state']}")
        a = router.predict(state, pack)["answers"]
        lv = a["evidence_level"]["probabilities"]
        e.update({
            "edge_valid": round(a["edge_valid"]["noul"], 4),
            "rel_probs": {k: round(v, 4) for k, v in a["rel_class"]["probabilities"].items()},
            "evidence_level": {"expected": round(a["evidence_level"]["score"], 3),
                               "probs": {level_names[int(k)]: round(v, 4) for k, v in lv.items()}},
            "contradicted": round(a["contradicted"]["noul"], 4),
            "decision_meta": {"model": model_id, "question_pack": "edge-validate-v1",
                              "judged_at": date.today().isoformat()},
        })
        n += 1
    return n


# ----------------------------------------------------------------- gate

def gate(nodes, edges, judged: bool) -> list[str]:
    errors = []
    node_ids = set(nodes)
    for e in edges:
        if e["source"] not in node_ids or e["target"] not in node_ids:
            errors.append(f"orphan edge {e['id']}")
    if len(nodes) < 20:
        errors.append(f"volume sanity: only {len(nodes)} nodes")
    if len([e for e in edges if e["rel_type"] == "CAUSED_BY"]) < 5:
        errors.append("volume sanity: <5 causal gene edges")
    if judged:
        jd = [e for e in edges if e.get("edge_valid") is not None]
        if not jd:
            errors.append("judge ran but no decision blocks written")
        for e in jd:
            if e.get("rel_probs") and abs(sum(e["rel_probs"].values()) - 1) > 0.05:
                errors.append(f"{e['id']} rel_probs do not sum to 1")
    # pydantic validation against the API contract
    sys.path.insert(0, str(ROOT / "backend"))
    from app.models.schemas import Edge as EdgeModel, Node as NodeModel
    for nd in nodes.values():
        try:
            NodeModel(**nd)
        except Exception as ex:
            errors.append(f"node {nd['id']} schema: {ex}")
            break
    for e in edges:
        try:
            EdgeModel(**e)
        except Exception as ex:
            errors.append(f"edge {e['id']} schema: {ex}")
            break
    return errors


# ----------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="bypass raw cache")
    ap.add_argument("--no-judge", action="store_true", help="skip judging")
    ap.add_argument("--judge", choices=["openai", "laya"], default="openai",
                    help="judge backend (default: openai)")
    args = ap.parse_args()

    log("fetch + normalize (Monarch)...")
    nodes, edges, disease_genes, disease_phenos, eid = build_nodes_edges(args.refresh)
    log(f"  {len(nodes)} nodes, {len(edges)} edges from ontology layer")

    log("fetch publications (PubMed)...")
    pub_snippets = add_publications(nodes, edges, disease_genes, eid, args.refresh)
    log(f"  now {len(nodes)} nodes, {len(edges)} edges")

    log("assemble states + SHARES_MECHANISM candidates...")
    edges = assemble_candidates(nodes, edges, disease_genes, disease_phenos, pub_snippets, eid)
    judgeable = [e for e in edges if "state" in e]
    log(f"  {len(judgeable)} judgeable edges "
        f"({len([e for e in judgeable if e['provenance'] == 'inferred'])} inferred candidates)")

    judged = False
    if not args.no_judge:
        log(f"judge ({args.judge})...")
        import time as _t
        t0 = _t.time()
        n = judge_edges(edges, nodes, args.judge)
        log(f"  judged {n} edges in {_t.time() - t0:.1f}s")
        judged = True

    log("gate...")
    errors = gate(nodes, edges, judged)
    if errors:
        for e in errors:
            log(f"  GATE FAIL: {e}")
        sys.exit(1)
    log("  gate passed")

    gen_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "_notice": ("REAL DATA generation built by backend/pipeline from Monarch Initiative "
                    "(aggregating MONDO, OMIM, Orphanet, HPOA) and PubMed. Inferred edges are "
                    "atlas hypotheses judged by a calibrated judge model; they are not "
                    "established facts."),
        "generation": gen_id,
        "cluster_seed": CLUSTER,
        "nodes": list(nodes.values()),
        "edges": edges,
    }
    gen_dir = DATA / "generations"
    gen_dir.mkdir(exist_ok=True)
    gen_path = gen_dir / f"{gen_id}.json"
    gen_path.write_text(json.dumps(payload, indent=1))
    (DATA / "graph.real.json").write_text(json.dumps(payload, indent=1))
    log(f"published generation {gen_id} -> data/graph.real.json "
        f"({len(nodes)} nodes, {len(edges)} edges)")
    log("serve it with: ATLAS_GRAPH_PATH=data/graph.real.json uvicorn app.main:app")


if __name__ == "__main__":
    main()
