"""Basic-research router: live PubMed/PMC lookups for the research pages.

Python port of the Lovable atlas prototype's connectors
(sources.server.ts + research-classification.ts):
  - pubmedByQuery (esearch + esummary)
  - pubmedResearchRecords (efetch XML: abstract, publication types, MeSH)
  - classifyResearch (organism/model rules; PubMed indexing beats text)
  - pmcFullText (PMC BioC open-access JSON)

Design notes kept from the prototype:
  - Every outbound call is cached (in-memory TTL here; the prototype used a
    7-day DB cache) and failures degrade to labeled errors, never 500s.
  - NCBI without an API key allows ~3 req/s; calls are sequential.
  - Organism/model mentions are signals, not confirmation; reviews are
    labeled separately and indexed reviews override model labels.
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

from fastapi import APIRouter, HTTPException

from ..services.graph_store import get_store

router = APIRouter(prefix="/api")

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
BIOC = "https://www.ncbi.nlm.nih.gov/research/bionlp/RESTful/pmcoa.cgi/BioC_json"
UA = "RareDiseaseAtlas/1.0 (research tool)"
CACHE_TTL = 7 * 24 * 3600  # 7 days, mirroring the prototype

_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = threading.Lock()


def _fetch(key: str, url: str, as_text: bool = False) -> Any:
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL:
            return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8", errors="replace")
    except Exception as e:  # stale-if-error: keep serving an expired entry
        with _cache_lock:
            if hit:
                return hit[1]
        raise RuntimeError(f"{key.split(':', 1)[0]} unavailable: {e}") from e
    data = raw if as_text else json.loads(raw)
    with _cache_lock:
        _cache[key] = (now, data)
    return data


def _enc(s: str) -> str:
    return urllib.parse.quote(s, safe="")


# ---- PubMed search + summaries (port of pubmedByQuery) ----

def pubmed_by_query(query: str, retmax: int = 15) -> dict:
    s = _fetch(
        f"pubmed:q:{retmax}:{query.lower()}",
        f"{EUTILS}/esearch.fcgi?db=pubmed&term={_enc(query)}&retmode=json&retmax={retmax}&sort=relevance",
    )
    ids = s.get("esearchresult", {}).get("idlist", [])
    total = int(s.get("esearchresult", {}).get("count", 0))
    if not ids:
        return {"total": total, "papers": []}
    m = _fetch(
        f"pubmed:summary:{','.join(ids)}",
        f"{EUTILS}/esummary.fcgi?db=pubmed&id={','.join(ids)}&retmode=json",
    )
    papers = []
    for pid in ids:
        d = m.get("result", {}).get(pid)
        if not d:
            continue
        aids = {a.get("idtype"): a.get("value") for a in d.get("articleids", [])}
        papers.append({
            "pmid": pid,
            "title": re.sub(r"</?[^>]+>", "", d.get("title") or "Untitled"),
            "journal": d.get("fulljournalname") or d.get("source") or "",
            "date": d.get("pubdate") or "",
            "authors": [a.get("name", "") for a in d.get("authors", [])][:6],
            "pmcid": aids.get("pmc"),
            "doi": aids.get("doi"),
        })
    return {"total": total, "papers": papers}


# ---- Research records (port of pubmedResearchRecords) ----

def pubmed_research_records(pmids: list[str]) -> dict[str, dict]:
    ids = sorted({p for p in pmids if re.fullmatch(r"\d{1,9}", p)})
    if not ids:
        return {}
    xml_text = _fetch(
        f"pubmed:research-records:v1:{','.join(ids)}",
        f"{EUTILS}/efetch.fcgi?db=pubmed&id={','.join(ids)}&retmode=xml",
        as_text=True,
    )
    if re.search(r"<ERROR[\s>]", xml_text, re.I):
        raise RuntimeError("PubMed could not return research classifications")
    records: dict[str, dict] = {}
    root = ET.fromstring(xml_text)
    for art in root.iter("PubmedArticle"):
        cit = art.find("MedlineCitation")
        if cit is None:
            continue
        pmid_el = cit.find("PMID")
        if pmid_el is None or not (pmid_el.text or "").strip():
            continue
        pmid = pmid_el.text.strip()
        abstract = "\n\n".join(
            "".join(t.itertext()).strip()
            for t in cit.findall(".//Abstract/AbstractText")
        ).strip() or None
        pub_types = [
            (t.text or "").strip()
            for t in cit.findall(".//PublicationTypeList/PublicationType")
        ]
        mesh = [
            (t.text or "").strip()
            for t in cit.findall(".//MeshHeadingList/MeshHeading/DescriptorName")
        ]
        records[pmid] = {
            "abstract": abstract,
            "publicationTypes": pub_types,
            "meshTerms": mesh,
        }
    return records


# ---- Classification rules (port of research-classification.ts) ----

ORGANISMS: list[tuple[str, str]] = [
    ("Mouse", r"\b(mouse|mice|murine|mus musculus)\b"),
    ("Rat", r"\b(rat|rats|rattus|sprague.dawley)\b"),
    ("Zebrafish", r"\b(zebrafish|danio rerio)\b"),
    ("Fruit fly", r"\b(drosophila|fruit fl(?:y|ies))\b"),
    ("C. elegans", r"\b(c\.?\s*elegans|caenorhabditis|nematodes?)\b"),
    ("Pig", r"\b(pigs?|piglets?|porcine|swine|sus scrofa)\b"),
    ("Ferret", r"\b(ferrets?|mustela putorius)\b"),
    ("Rabbit", r"\b(rabbits?|oryctolagus)\b"),
    ("Guinea pig", r"\b(guinea pigs?|cavia porcellus)\b"),
    ("Hamster", r"\b(hamsters?|mesocricetus|cricetulus)\b"),
    ("Dog", r"\b(dogs?|canine|canis lupus familiaris)\b"),
    ("Cat", r"\b(cats?|feline|felis catus)\b"),
    ("Sheep", r"\b(sheep|ovine|ovis aries)\b"),
    ("Goat", r"\b(goats?|caprine|capra hircus)\b"),
    ("Cattle", r"\b(cattle|bovine|bos taurus|calves)\b"),
    ("Horse", r"\b(horses?|equine|equus caballus)\b"),
    ("Non-human primate",
     r"\b(monkeys?|macaques?|marmosets?|baboons?|rhesus|non.human primates?|macaca)\b"),
    ("Chicken", r"\b(chickens?|chick embryos?|gallus gallus)\b"),
    ("Xenopus", r"\b(xenopus|african clawed frogs?)\b"),
    ("Medaka", r"\b(medaka|oryzias latipes)\b"),
    ("Killifish", r"\b(killifish|nothobranchius)\b"),
    ("Axolotl", r"\b(axolotls?|ambystoma mexicanum)\b"),
    ("Yeast", r"\b(yeasts?|saccharomyces|schizosaccharomyces)\b"),
    ("Dictyostelium", r"\bdictyostelium\b"),
    ("D. rerio", r"\bd\.?\s*rerio\b"),
    ("Galleria mellonella", r"\b(galleria mellonella|wax moth)\b"),
    ("Human",
     r"\b(humans?|human.derived|patient.derived|patients?['\u2019]? (?:cells|tissues|fibroblasts)|humanized)\b"),
    ("Pseudomonas", r"\b(pseudomonas|p\.?\s*aeruginosa)\b"),
    ("E. coli", r"\b(escherichia coli|e\.?\s*coli)\b"),
    ("Staphylococcus", r"\b(staphylococcus|s\.?\s*aureus)\b"),
    ("Burkholderia", r"\bburkholderia\b"),
    ("Mycobacterium", r"\bmycobacteri(?:um|a)\b"),
    ("Candida", r"\bcandida\b"),
    ("Aspergillus", r"\baspergillus\b"),
    ("Arabidopsis", r"\barabidopsis\b"),
]

MODELS: list[tuple[str, str]] = [
    ("iPSC", r"\b(ipscs?|induced pluripotent)\b"),
    ("Embryonic stem cells", r"\b(embryonic stem cells?|hescs?)\b"),
    ("Stem-cell-derived model", r"\bstem.cell.derived\b"),
    ("Organoid", r"\borganoids?\b"),
    ("Spheroid", r"\bspheroids?\b"),
    ("Organ-on-chip",
     r"\b(?:organ|lung|gut|brain|kidney|heart|tissue).on.(?:a.)?chip\b"),
    ("Patient-derived cells",
     r"\bpatient.derived (?:cells?|fibroblasts?|neurons?|epithelia|cultures?|models?)\b"),
    ("Primary cell culture",
     r"\b(primary (?:cells?|cultures?|neurons?|fibroblasts?)|primary.*cell cultures?)\b"),
    ("Cell line",
     r"\b(cell lines?|immortali[sz]ed|hek.?293|hela|cho cells?|a549|beas.2b|cfbe41|ib3.1)\b"),
    ("Cell culture", r"\b(in vitro|cultured cells?|cell cultures?)\b"),
    ("Ex vivo tissue", r"\b(ex vivo|tissue explants?|organotypic|tissue slices?)\b"),
    ("3D culture",
     r"\b(3.?d(?:imensional)? (?:culture|model)|three.dimensional (?:culture|model))\b"),
    ("Computational model",
     r"\b(in silico|computational model|molecular dynamics|mathematical model|agent.based model)\b"),
    ("Biochemical assay",
     r"\b(cell.free|purified proteins?|reconstituted (?:system|assay)|biochemical assays?)\b"),
]

RULES = (
    [{"label": l, "kind": "organism", "re": re.compile(p, re.I)} for l, p in ORGANISMS]
    + [{"label": l, "kind": "model", "re": re.compile(p, re.I)} for l, p in MODELS]
)

# Indexed animal/experimental terms and reviews broaden retrieval beyond a
# few named models (verbatim from the prototype).
BASIC_RESEARCH_QUERY = (
    '("Animals"[mh] OR "Models, Animal"[mh] OR "Disease Models, Animal"[mh]'
    ' OR "Cells, Cultured"[mh] OR "Models, Biological"[mh] OR "Organoids"[mh]'
    ' OR "Stem Cells"[mh] OR "Review"[pt] OR model*[tiab] OR in vitro[tiab]'
    " OR ex vivo[tiab] OR organoid*[tiab] OR iPSC[tiab] OR cell line[tiab]"
    " OR zebrafish[tiab] OR drosophila[tiab] OR mouse[tiab] OR mice[tiab]"
    " OR rat[tiab] OR ferret[tiab] OR porcine[tiab] OR yeast[tiab]"
    " OR nematode[tiab])"
)

_TITLE_REVIEW = re.compile(
    r"(?:^review:|\b(?:systematic|scoping|narrative|comprehensive) review\b"
    r"|:\s*(?:a |an )?review\b)",
    re.I,
)
_GUINEA = re.compile(r"guinea pigs?", re.I)


def classify_research(title: str, record: dict | None) -> dict:
    rec = record or {}
    review_type = next(
        (t for t in rec.get("publicationTypes", []) if re.search(r"\breview\b", t, re.I)),
        None,
    )
    if review_type or _TITLE_REVIEW.search(title):
        return {
            "models": ["Review"],
            "classification": [{
                "label": "Review", "kind": "article",
                "source": "PubMed indexing" if review_type else "Title / abstract",
                "snippet": review_type or title,
            }],
        }
    text = f"{title}\n{rec.get('abstract') or ''}"
    sentences = re.split(r"(?<=[.!?])\s+|\n", text)
    out: list[dict] = []
    for rule in RULES:
        indexed = next((t for t in rec.get("meshTerms", []) if rule["re"].search(t)), None)
        sentence = next((s for s in sentences if rule["re"].search(s)), None)
        if not indexed and not sentence:
            continue
        # "Guinea pig" is a distinct organism, not evidence for a pig model.
        if rule["label"] == "Pig":
            if not rule["re"].search(_GUINEA.sub("", text)) and not any(
                rule["re"].search(_GUINEA.sub("", t)) for t in rec.get("meshTerms", [])
            ):
                continue
        label = "Zebrafish" if rule["label"] == "D. rerio" else rule["label"]
        if any(item["label"] == label for item in out):
            continue
        out.append({
            "label": label, "kind": rule["kind"],
            "source": "PubMed indexing" if indexed else "Title / abstract",
            "snippet": indexed or sentence or title,
        })
    return {
        "models": [i["label"] for i in out] if out else ["Unclassified"],
        "classification": out,
    }


# ---- PMC full text (port of pmcFullText) ----

_SKIP_SECTIONS = {"REF", "COMP_INT", "AUTH_CONT", "ACK_FUND", "SUPPL"}


def pmc_full_text(pmcid: str) -> dict | None:
    try:
        r = _fetch(f"pmc:bioc:{pmcid}", f"{BIOC}/{_enc(pmcid)}/unicode")
    except RuntimeError as e:
        # The service answers non-JSON/404 for articles outside the OA subset.
        if re.search(r"JSON|404", str(e)):
            return None
        raise
    except json.JSONDecodeError:
        return None
    doc = (r[0] if isinstance(r, list) else r or {}).get("documents", [None])[0]
    if not doc:
        return None
    sections: list[dict] = []
    title = ""
    for p in doc.get("passages", []):
        stype = str(p.get("infons", {}).get("section_type", "OTHER"))
        kind = str(p.get("infons", {}).get("type", ""))
        text = str(p.get("text", "")).strip()
        if not text or stype in _SKIP_SECTIONS:
            continue
        if stype == "TITLE":
            title = text
            continue
        if kind.startswith("title"):
            sections.append({"type": stype, "heading": text, "paragraphs": []})
            continue
        if "caption" in kind or kind == "table":
            continue
        if sections and sections[-1]["type"] == stype:
            sections[-1]["paragraphs"].append(text)
        else:
            sections.append({
                "type": stype,
                "heading": "Abstract" if stype == "ABSTRACT" else None,
                "paragraphs": [text],
            })
    return {
        "id": doc.get("id"),
        "title": title,
        "license": doc.get("infons", {}).get("license"),
        "sections": sections,
    }


# ---- Routes ----

@router.get("/diseases/{disease_id}/research")
def basic_research(disease_id: str):
    """Lab and animal-model studies for a disease (port of getBasicResearch)."""
    node = get_store().get_node(disease_id)
    if node is None:
        raise HTTPException(404, f"disease not found: {disease_id}")
    term = node.name
    base = {"disease": {"id": disease_id, "label": term}}
    try:
        r = pubmed_by_query(f'"{term}"[tiab] AND {BASIC_RESEARCH_QUERY}', 40)
        # Synthetic demo names ("Demo Lysosomal Storage Disorder A") have no
        # literature; retry with the underlying real term so the page still
        # demonstrates the live pipeline.
        if not r["papers"] and term.lower().startswith("demo "):
            cleaned = re.sub(r"\s+[A-Z]$", "", term[5:]).strip()
            if cleaned:
                r = pubmed_by_query(f'"{cleaned}"[tiab] AND {BASIC_RESEARCH_QUERY}', 40)
    except RuntimeError as e:
        return {**base, "total": 0, "papers": [], "counts": {},
                "classificationError": None, "error": str(e)}
    classification_error = None
    try:
        records = pubmed_research_records([p["pmid"] for p in r["papers"]])
    except RuntimeError as e:
        classification_error = str(e)
        records = {}
    papers = [
        {**p, **classify_research(p["title"], records.get(p["pmid"]))}
        for p in r["papers"]
    ]
    counts: dict[str, int] = {}
    for p in papers:
        for m in p["models"]:
            counts[m] = counts.get(m, 0) + 1
    return {**base, "total": r["total"], "papers": papers, "counts": counts,
            "classificationError": classification_error, "error": None}


@router.get("/papers/{pmid}")
def paper(pmid: str):
    """Paper summary + open-access full text when available (port of getPaper)."""
    if not re.fullmatch(r"\d{1,9}", pmid):
        raise HTTPException(422, "pmid must be 1-9 digits")
    try:
        r = pubmed_by_query(f"{pmid}[uid]", 1)
    except RuntimeError:
        r = {"total": 0, "papers": []}
    p = r["papers"][0] if r["papers"] else None
    if not p:
        return {"paper": None, "fullText": None, "error": "Not found in PubMed"}
    if not p["pmcid"]:
        return {"paper": p, "fullText": None, "error": None}
    try:
        return {"paper": p, "fullText": pmc_full_text(p["pmcid"]), "error": None}
    except RuntimeError as e:
        return {"paper": p, "fullText": None, "error": str(e)}
