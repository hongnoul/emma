"""v1 API: six generic primitives for any frontend or agent.

Design (docs/api-mcp-plan.md): expose graph + judgment primitives, not pages.
New features (symptom search, mechanism scans) are client-side compositions.
Every response carries generation_id so clients can cache-key correctly.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..models.schemas import Edge, Node, PathStep
from ..services import atlas
from ..services.evals import run_evals
from ..services.graph_store import get_store

router = APIRouter(prefix="/v1", tags=["v1"])


class Envelope(BaseModel):
    generation_id: str


class EntityHit(BaseModel):
    node: Node
    match: str                    # "name" | "synonym" | "description"
    parents: list[Node] = []      # SUBTYPE_OF targets, for hierarchy context
    subtype_count: int = 0
    connections: dict[str, int] = {}


class EntitiesResponse(Envelope):
    total: int
    items: list[EntityHit]


class EntityDetail(Envelope):
    node: Node
    connections: dict[str, int]
    parents: list[Node]
    subtypes: list[Node]


class EdgesResponse(Envelope):
    total: int
    limit: int
    offset: int
    items: list[Edge]


class PathResponse(Envelope):
    path: list[PathStep]
    known: list[str]
    inferred: list[str]
    uncertain: list[str]
    narrative: str
    evidence_edges: list[Edge]


@router.get("/entities", response_model=EntitiesResponse)
def resolve(q: str = Query(..., min_length=1), types: str = Query("", description="comma-separated NodeTypes"),
            limit: int = Query(20, ge=1, le=100)):
    """Resolve a query string to entities of any type, with synonym matching
    and hierarchy context."""
    store = get_store()
    ql = q.lower().strip()
    want = {t.strip() for t in types.split(",") if t.strip()}
    hits: list[tuple[int, EntityHit]] = []
    for n in store.nodes.values():
        if want and n.type not in want:
            continue
        match = None
        if ql in n.name.lower():
            match, rank = "name", 0 if n.name.lower().startswith(ql) else 1
        elif n.synonyms and any(ql in s.lower() for s in n.synonyms):
            match, rank = "synonym", 2
        elif ql in (n.description or "").lower():
            match, rank = "description", 3
        if match is None:
            continue
        parents = [store.nodes[e.target] for e in store.edges_out(n.id, "SUBTYPE_OF")
                   if e.target in store.nodes]
        subtype_count = len(store.edges_in(n.id, "SUBTYPE_OF"))
        hits.append((rank, EntityHit(node=n, match=match, parents=parents[:3],
                                     subtype_count=subtype_count,
                                     connections=store.adjacency_summary(n.id))))
    hits.sort(key=lambda t: (t[0], t[1].node.name))
    return EntitiesResponse(generation_id=store.generation, total=len(hits),
                            items=[h for _, h in hits[:limit]])


@router.get("/entities/{curie}", response_model=EntityDetail)
def fetch(curie: str):
    store = get_store()
    n = store.get_node(curie)
    if n is None:
        raise HTTPException(404, f"entity not found: {curie}")
    parents = [store.nodes[e.target] for e in store.edges_out(curie, "SUBTYPE_OF") if e.target in store.nodes]
    subtypes = [store.nodes[e.source] for e in store.edges_in(curie, "SUBTYPE_OF") if e.source in store.nodes]
    return EntityDetail(generation_id=store.generation, node=n,
                        connections=store.adjacency_summary(curie),
                        parents=parents, subtypes=subtypes[:50])


@router.get("/edges", response_model=EdgesResponse)
def traverse(from_id: str | None = Query(None, alias="from"),
             to_id: str | None = Query(None, alias="to"),
             node: str | None = Query(None, description="match either endpoint"),
             rel_types: str = Query("", description="comma-separated"),
             provenance: str | None = Query(None, pattern="^(curated|inferred)$"),
             min_valid: float | None = Query(None, ge=0, le=1),
             max_valid: float | None = Query(None, ge=0, le=1),
             judged_only: bool = False,
             limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """The workhorse: any edge query, filterable by endpoint, channel,
    provenance, and judged confidence."""
    store = get_store()
    rts = [t.strip() for t in rel_types.split(",") if t.strip()] or None
    page, total = store.query_edges(from_id=from_id, to_id=to_id, node_id=node,
                                    rel_types=rts, provenance=provenance,
                                    min_valid=min_valid, max_valid=max_valid,
                                    judged_only=judged_only,
                                    limit=limit, offset=offset)
    return EdgesResponse(generation_id=store.generation, total=total,
                         limit=limit, offset=offset, items=page)


class EdgeDetail(Envelope):
    edge: Edge
    source_node: Node | None = None
    target_node: Node | None = None


@router.get("/edges/{edge_id}", response_model=EdgeDetail)
def edge_detail(edge_id: str):
    """One edge with full decision block plus endpoint nodes (for workbench views)."""
    store = get_store()
    e = store.edges.get(edge_id)
    if e is None:
        raise HTTPException(404, f"edge not found: {edge_id}")
    return EdgeDetail(generation_id=store.generation, edge=e,
                      source_node=store.get_node(e.source),
                      target_node=store.get_node(e.target))


@router.get("/paths")
def path(from_id: str = Query(..., alias="from"), to_id: str = Query(..., alias="to"),
         audience: str = Query("researcher", pattern="^(patient|researcher)$")):
    """Why-connected for any node pair (not just diseases).

    Trust layer: every evidence edge carries its calibrated band and gate
    action; the whole path carries p_path with weakest-link attribution.
    """
    from ..services import trust as _trust
    c = atlas.explain_connection(from_id, to_id)
    if c is None:
        raise HTTPException(404, "one or both nodes not found")
    store = get_store()
    valids, contras = [], []
    gated = []
    for e in c.evidence_edges:
        ev = e.evidence_level.expected if e.evidence_level else None
        pack = e.decision_meta.question_pack if e.decision_meta else "edge-validate-v1"
        g = _trust.gate(e.edge_valid, e.contradicted, ev, pack, audience, e.provenance)
        gated.append({"edge_id": e.id, **g,
                      "band": g["band"], "p_valid": e.edge_valid})
        if e.edge_valid is not None:
            valids.append(e.edge_valid)
            contras.append(e.contradicted or 0.0)
    conf = _trust.path_confidence(valids, contras)
    base = PathResponse(generation_id=store.generation, path=c.path, known=c.known,
                        inferred=c.inferred, uncertain=c.uncertain,
                        narrative=c.narrative, evidence_edges=c.evidence_edges)
    out = base.model_dump()
    out["trust"] = {"audience": audience, "edges": gated, **conf}
    return out


class JudgeRequest(BaseModel):
    state: str
    pack_id: str = "edge-validate-v1"


# The local Laya judge is not safe under concurrent forward passes (MPS/Metal
# command-buffer assertions kill the process). FastAPI runs sync endpoints in
# a threadpool, so serialize every live prediction behind one lock.
import threading
_judge_lock = threading.Lock()


def _predict(svc, state: str, questions: dict) -> dict:
    with _judge_lock:
        return svc._router.predict(state, questions)  # type: ignore[attr-defined]


def _live_judge():
    """Return the decision service if a real judge is configured, else None."""
    import os
    if os.environ.get("ATLAS_JUDGE") not in ("laya", "openai"):
        return None
    from ..services.decision_service import get_decision_service
    return get_decision_service()


_JUDGE_501 = ("on-demand judging not enabled on this deployment "
              "(set ATLAS_JUDGE=openai with OPENAI_API_KEY, or "
              "ATLAS_JUDGE=laya with the laya package installed)")


@router.post("/judge")
def judge(req: JudgeRequest):
    """Judge an arbitrary state with a question pack.

    Requires a real judge on the serving process: ATLAS_JUDGE=openai (OpenAI
    logprobs judge, needs OPENAI_API_KEY) or ATLAS_JUDGE=laya (local Laya).
    Without one, returns 501 so clients can degrade gracefully; stored edge
    judgments are unaffected (they are precomputed into the graph).
    """
    svc = _live_judge()
    if svc is None:
        raise HTTPException(501, _JUDGE_501)
    pack = svc.packs.get(req.pack_id)
    if pack is None:
        raise HTTPException(404, f"unknown question pack: {req.pack_id}")
    result = _predict(svc, req.state, pack["questions"])
    return {"generation_id": get_store().generation, "pack_id": req.pack_id,
            "answers": result["answers"]}


# ---- ablation: which evidence item carries the judge's belief? ----

_EVIDENCE_LIST_MARKERS = [
    # (prefix the list follows, terminator) — bulk pipeline state format
    ("Shared informative HPO phenotypes: ", ". Causal genes"),
]


def _split_evidence_items(state: str) -> tuple[list[str], str, str] | None:
    """Find an ablatable list in a state snippet.

    Returns (items, head, tail) where state == head + ", ".join(items) + tail.
    None when the state has no recognizable list (client should fall back to
    manual what-if editing).
    """
    for marker, term in _EVIDENCE_LIST_MARKERS:
        start = state.find(marker)
        if start < 0:
            continue
        list_start = start + len(marker)
        end = state.find(term, list_start)
        if end < 0:
            continue
        items = [s.strip() for s in state[list_start:end].split(",") if s.strip()]
        if len(items) >= 2:
            return items, state[:list_start], state[end:]
    return None


class AblateResponse(BaseModel):
    generation_id: str
    edge_id: str
    pack_id: str
    baseline_valid: float
    baseline_contradicted: float | None = None
    items: list[dict]  # {removed, edge_valid, delta}


@router.post("/edges/{edge_id}/ablate", response_model=AblateResponse)
def ablate(edge_id: str, pack_id: str = "edge-validate-v1"):
    """Leave-one-out evidence ablation: re-judge the edge's state N times,
    each with one evidence item removed. delta = baseline - ablated, i.e.
    how much p(valid) that single item carries. Only possible because each
    judgment is one fast forward pass.
    """
    svc = _live_judge()
    if svc is None:
        raise HTTPException(501, _JUDGE_501)
    store = get_store()
    e = store.edges.get(edge_id)
    if e is None:
        raise HTTPException(404, f"edge not found: {edge_id}")
    if not e.state:
        raise HTTPException(422, "edge has no state snippet; nothing to ablate")
    pack = svc.packs.get(pack_id)
    if pack is None:
        raise HTTPException(404, f"unknown question pack: {pack_id}")
    split = _split_evidence_items(e.state)
    if split is None:
        raise HTTPException(422, "state has no recognizable evidence list; "
                                 "use POST /v1/judge with an edited state instead")
    items, head, tail = split
    questions = pack["questions"]
    baseline = _predict(svc, e.state, questions)["answers"]
    base_valid = baseline["edge_valid"]["noul"]
    results = []
    for i, item in enumerate(items):
        kept = items[:i] + items[i + 1:]
        ablated_state = head + ", ".join(kept) + tail
        a = _predict(svc, ablated_state, questions)["answers"]
        v = a["edge_valid"]["noul"]
        results.append({"removed": item, "edge_valid": round(v, 4),
                        "delta": round(base_valid - v, 4)})
    results.sort(key=lambda r: -r["delta"])
    return AblateResponse(generation_id=store.generation, edge_id=edge_id,
                          pack_id=pack_id, baseline_valid=round(base_valid, 4),
                          baseline_contradicted=round(baseline["contradicted"]["noul"], 4),
                          items=results)


@router.get("/evals")
def evals(judge: str = Query("mock", pattern="^(mock|laya|openai|laya-v2|openai-v2)$")):
    from ..services.evals import expert_extra
    from ..services import trust as _trust
    r = run_evals(judge)
    out = {"generation_id": get_store().generation, **r.model_dump()}
    out.update(expert_extra(r))
    out["policy"] = {"established_threshold": _trust.ESTABLISHED_THRESHOLD,
                     "hide_threshold": _trust.HIDE_THRESHOLD,
                     "fp_cost": _trust.FP_COST, "fn_cost": _trust.FN_COST,
                     "caveat_language": _trust.CAVEAT_LANGUAGE,
                     "contested_edges": _trust.contested_ids()}
    return out


@router.get("/meta")
def meta():
    store = get_store()
    from collections import Counter
    import os
    types = Counter(n.type for n in store.nodes.values())
    rels = Counter(e.rel_type for e in store.edges.values())
    return {"generation_id": store.generation, "nodes": len(store.nodes),
            "edges": len(store.edges), "node_types": dict(types), "rel_types": dict(rels),
            "judge": os.environ.get("ATLAS_JUDGE") or "none"}
