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
             judged_only: bool = False,
             limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0)):
    """The workhorse: any edge query, filterable by endpoint, channel,
    provenance, and judged confidence."""
    store = get_store()
    rts = [t.strip() for t in rel_types.split(",") if t.strip()] or None
    page, total = store.query_edges(from_id=from_id, to_id=to_id, node_id=node,
                                    rel_types=rts, provenance=provenance,
                                    min_valid=min_valid, judged_only=judged_only,
                                    limit=limit, offset=offset)
    return EdgesResponse(generation_id=store.generation, total=total,
                         limit=limit, offset=offset, items=page)


@router.get("/paths", response_model=PathResponse)
def path(from_id: str = Query(..., alias="from"), to_id: str = Query(..., alias="to")):
    """Why-connected for any node pair (not just diseases)."""
    c = atlas.explain_connection(from_id, to_id)
    if c is None:
        raise HTTPException(404, "one or both nodes not found")
    store = get_store()
    return PathResponse(generation_id=store.generation, path=c.path, known=c.known,
                        inferred=c.inferred, uncertain=c.uncertain,
                        narrative=c.narrative, evidence_edges=c.evidence_edges)


class JudgeRequest(BaseModel):
    state: str
    pack_id: str = "edge-validate-v1"


@router.post("/judge")
def judge(req: JudgeRequest):
    """Judge an arbitrary state with a question pack.

    Requires a real judge on the serving process: ATLAS_JUDGE=openai (OpenAI
    logprobs judge, needs OPENAI_API_KEY) or ATLAS_JUDGE=laya (local Laya).
    Without one, returns 501 so clients can degrade gracefully; stored edge
    judgments are unaffected (they are precomputed into the graph).
    """
    import os
    if os.environ.get("ATLAS_JUDGE") not in ("laya", "openai"):
        raise HTTPException(501, "on-demand judging not enabled on this deployment "
                                 "(set ATLAS_JUDGE=openai with OPENAI_API_KEY, or "
                                 "ATLAS_JUDGE=laya with the laya package installed)")
    from ..services.decision_service import get_decision_service
    svc = get_decision_service()
    pack = svc.packs.get(req.pack_id)
    if pack is None:
        raise HTTPException(404, f"unknown question pack: {req.pack_id}")
    result = svc._router.predict(req.state, pack["questions"])  # type: ignore[attr-defined]
    return {"generation_id": get_store().generation, "pack_id": req.pack_id,
            "answers": result["answers"]}


@router.get("/evals")
def evals(judge: str = Query("mock", pattern="^(mock|laya|openai)$")):
    r = run_evals(judge)
    return {"generation_id": get_store().generation, **r.model_dump()}


@router.get("/meta")
def meta():
    store = get_store()
    from collections import Counter
    types = Counter(n.type for n in store.nodes.values())
    rels = Counter(e.rel_type for e in store.edges.values())
    return {"generation_id": store.generation, "nodes": len(store.nodes),
            "edges": len(store.edges), "node_types": dict(types), "rel_types": dict(rels)}
