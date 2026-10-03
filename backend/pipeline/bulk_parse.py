"""Bulk parsers for ontology release files (data/raw/bulk/).

Sources (official releases, fetched by pipeline/bulk_run.py):
  mondo.obo             disease ontology: ids, names, defs, xrefs, obsolete flags
  hp.obo                phenotype term names
  phenotype.hpoa        disease (OMIM/ORPHA) -> HPO annotations with frequency
  genes_to_disease.txt  gene symbol/NCBI id -> disease (OMIM/ORPHA/MONDO)

Reconciliation: MONDO is the spine. phenotype.hpoa and genes_to_disease key
diseases by OMIM:/ORPHA:, so we invert mondo.obo xrefs to map them in.
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

BULK = Path(__file__).resolve().parents[2] / "data" / "raw" / "bulk"


def parse_obo(path: Path, want_xrefs: bool = False):
    """Minimal OBO parser -> {id: {name, definition, xrefs[], is_obsolete, parents[]}}."""
    terms = {}
    cur = None
    for line in path.open(encoding="utf-8"):
        line = line.rstrip("\n")
        if line == "[Term]":
            cur = {}
            continue
        if line.startswith("[") and line != "[Term]":  # [Typedef] etc.
            cur = None
            continue
        if cur is None:
            continue
        if line.startswith("id: "):
            cur["id"] = line[4:].strip()
            terms[cur["id"]] = cur
        elif line.startswith("name: "):
            cur["name"] = line[6:].strip()
        elif line.startswith("def: "):
            m = re.match(r'def: "(.*?)"', line)
            if m:
                cur["definition"] = m.group(1)
        elif want_xrefs and line.startswith("xref: "):
            cur.setdefault("xrefs", []).append(line[6:].split(" ")[0].strip())
        elif line.startswith("synonym: "):
            m = re.match(r'synonym: "(.*?)"', line)
            if m:
                cur.setdefault("synonyms", []).append(m.group(1))
        elif line.startswith("is_a: "):
            cur.setdefault("parents", []).append(line[6:].split(" ")[0].strip())
        elif line.startswith("is_obsolete: true"):
            cur["is_obsolete"] = True
    return terms


def mondo_diseases() -> tuple[dict, dict]:
    """Returns (diseases, xref_to_mondo).

    diseases: {mondo_id: {name, definition, parents}} non-obsolete only.
    xref_to_mondo: {"OMIM:123456": "MONDO:0000001", "Orphanet:789": ...}
    """
    terms = parse_obo(BULK / "mondo.obo", want_xrefs=True)
    diseases, xref_map = {}, {}
    for tid, t in terms.items():
        if not tid.startswith("MONDO:") or t.get("is_obsolete"):
            continue
        diseases[tid] = {"name": t.get("name", tid),
                         "definition": t.get("definition", ""),
                         "parents": t.get("parents", []),
                         "synonyms": t.get("synonyms", [])[:8]}
        for x in t.get("xrefs", []):
            if x.startswith(("OMIM:", "Orphanet:")):
                xref_map[x] = tid
    return diseases, xref_map


def hp_labels() -> dict:
    terms = parse_obo(BULK / "hp.obo")
    return {tid: t.get("name", tid) for tid, t in terms.items() if tid.startswith("HP:")}


FREQ_WEIGHT = {  # HPO frequency qualifier -> rough fraction, for similarity weighting
    "HP:0040280": 1.0,   # obligate
    "HP:0040281": 0.9,   # very frequent
    "HP:0040282": 0.55,  # frequent
    "HP:0040283": 0.17,  # occasional
    "HP:0040284": 0.04,  # very rare
    "HP:0040285": 0.0,   # excluded
}


def disease_phenotypes(xref_to_mondo: dict) -> dict:
    """phenotype.hpoa -> {mondo_id: {hp_id: weight}} (negated rows dropped)."""
    out: dict[str, dict[str, float]] = defaultdict(dict)
    path = BULK / "phenotype.hpoa"
    for line in path.open(encoding="utf-8"):
        if line.startswith(("#", "database_id")):
            continue
        f = line.rstrip("\n").split("\t")
        if len(f) < 8:
            continue
        db_id, qualifier, hp_id, freq = f[0], f[2], f[3], f[7]
        if qualifier == "NOT":
            continue
        mondo = xref_to_mondo.get(db_id.replace("ORPHA:", "Orphanet:"))
        if not mondo:
            continue
        w = FREQ_WEIGHT.get(freq, 0.4)  # unknown frequency -> middling weight
        prev = out[mondo].get(hp_id, 0.0)
        out[mondo][hp_id] = max(prev, w)
    return dict(out)


def disease_genes(xref_to_mondo: dict) -> dict:
    """genes_to_disease.txt -> {mondo_id: {gene_symbol}} (causal associations)."""
    out: dict[str, set] = defaultdict(set)
    path = BULK / "genes_to_disease.txt"
    for line in path.open(encoding="utf-8"):
        if line.startswith(("#", "ncbi_gene_id")):
            continue
        f = line.rstrip("\n").split("\t")
        if len(f) < 4:
            continue
        symbol, assoc, disease_id = f[1], f[2], f[3]
        if "MENDELIAN" not in assoc.upper():  # keep causal, drop polygenic/unknown
            continue
        mondo = disease_id if disease_id.startswith("MONDO:") else \
            xref_to_mondo.get(disease_id.replace("ORPHA:", "Orphanet:"))
        if mondo:
            out[mondo].add(symbol)
    return dict(out)
