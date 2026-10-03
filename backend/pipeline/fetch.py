"""Fetch stage: pull raw records from Monarch v3 and PubMed into data/raw/.

Idempotent: every response is cached to disk keyed by a stable name; re-runs
hit the cache unless --refresh. Manifests record source, url, fetched_at.
"""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"

MONARCH = "https://api.monarchinitiative.org/v3/api"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
USER_AGENT = "rare-disease-atlas-prototype/0.1 (research prototype)"


def _get(url: str, cache_name: str, source: str, refresh: bool = False, sleep: float = 0.4) -> dict:
    cache = RAW / source / f"{cache_name}.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())["payload"]
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        payload = json.loads(r.read())
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({
        "manifest": {"source": source, "url": url,
                     "fetched_at": datetime.now(timezone.utc).isoformat()},
        "payload": payload,
    }, indent=1))
    time.sleep(sleep)  # be polite; NCBI unauthenticated limit is 3 req/s
    return payload


# ---------------------------------------------------------------- Monarch

def monarch_entity(curie: str, refresh=False) -> dict:
    return _get(f"{MONARCH}/entity/{urllib.parse.quote(curie)}",
                curie.replace(":", "_"), "monarch_entity", refresh)


def monarch_assoc(params: dict, cache_name: str, refresh=False) -> list[dict]:
    """Paginated association fetch."""
    items, offset = [], 0
    while True:
        q = urllib.parse.urlencode({**params, "limit": 100, "offset": offset})
        page = _get(f"{MONARCH}/association?{q}", f"{cache_name}_{offset}", "monarch_assoc", refresh)
        items.extend(page.get("items", []))
        if offset + 100 >= page.get("total", 0) or not page.get("items"):
            return items
        offset += 100


def monarch_search(q: str, category: str, limit: int, cache_name: str, refresh=False) -> list[dict]:
    qs = urllib.parse.urlencode({"q": q, "category": category, "limit": limit})
    return _get(f"{MONARCH}/search?{qs}", cache_name, "monarch_search", refresh).get("items", [])


# ---------------------------------------------------------------- PubMed

def pubmed_search(term: str, cache_name: str, retmax: int = 10, refresh=False) -> list[str]:
    qs = urllib.parse.urlencode({"db": "pubmed", "term": term, "retmax": retmax,
                                 "retmode": "json", "sort": "relevance"})
    d = _get(f"{EUTILS}/esearch.fcgi?{qs}", cache_name, "pubmed_search", refresh)
    return d["esearchresult"]["idlist"]


def pubmed_summaries(pmids: list[str], cache_name: str, refresh=False) -> dict:
    if not pmids:
        return {}
    qs = urllib.parse.urlencode({"db": "pubmed", "id": ",".join(pmids), "retmode": "json"})
    d = _get(f"{EUTILS}/esummary.fcgi?{qs}", cache_name, "pubmed_summary", refresh)
    return d.get("result", {})


def pubmed_abstracts(pmids: list[str], cache_name: str, refresh=False) -> str:
    """efetch returns plain-text abstracts; cached as one blob per query."""
    if not pmids:
        return ""
    cache = RAW / "pubmed_abstract" / f"{cache_name}.txt"
    if cache.exists() and not refresh:
        return cache.read_text()
    qs = urllib.parse.urlencode({"db": "pubmed", "id": ",".join(pmids),
                                 "rettype": "abstract", "retmode": "text"})
    req = urllib.request.Request(f"{EUTILS}/efetch.fcgi?{qs}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode("utf-8", errors="replace")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(text)
    time.sleep(0.4)
    return text
