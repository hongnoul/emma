"""API routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..models.schemas import (
    ConnectionExplanation, DiseaseDetail, Edge, EvalReport, GraphPayload,
    Opportunity, RelatedDisease, SearchResult,
)
from ..services import knowledge as atlas
from ..services.decision_service import get_decision_service
from ..services.evals import run_evals
from ..services.graph_store import get_store

router = APIRouter(prefix="/api")


@router.get("/search", response_model=list[SearchResult])
def search(q: str = Query("", description="query string")):
    return atlas.search(q)


@router.get("/graph", response_model=GraphPayload)
def graph():
    return atlas.full_graph()


@router.get("/graph.gexf")
def graph_gexf():
    """Full graph in GEXF for Gephi desktop (File > Open)."""
    from fastapi.responses import Response
    from ..services.gexf import to_gexf
    return Response(content=to_gexf(get_store()), media_type="application/xml",
                    headers={"Content-Disposition": 'attachment; filename="emmatics.gexf"'})


@router.get("/diseases/{disease_id}", response_model=DiseaseDetail)
def disease(disease_id: str):
    d = atlas.disease_detail(disease_id)
    if d is None:
        raise HTTPException(404, f"disease not found: {disease_id}")
    return d


@router.get("/diseases/{disease_id}/related", response_model=list[RelatedDisease])
def related(disease_id: str):
    if get_store().get_node(disease_id) is None:
        raise HTTPException(404, f"disease not found: {disease_id}")
    return atlas.related_diseases(disease_id)


@router.get("/diseases/{disease_id}/graph", response_model=GraphPayload)
def disease_graph(disease_id: str, depth: int = Query(2, ge=1, le=4)):
    if get_store().get_node(disease_id) is None:
        raise HTTPException(404, f"disease not found: {disease_id}")
    return atlas.disease_graph(disease_id, depth)


@router.get("/diseases/{disease_id}/evidence", response_model=list[Edge])
def evidence(disease_id: str):
    if get_store().get_node(disease_id) is None:
        raise HTTPException(404, f"disease not found: {disease_id}")
    return atlas.disease_evidence(disease_id)


@router.get("/diseases/{disease_id}/opportunities", response_model=list[Opportunity])
def opportunities(disease_id: str):
    if get_store().get_node(disease_id) is None:
        raise HTTPException(404, f"disease not found: {disease_id}")
    return atlas.opportunities(disease_id)


@router.get("/connections/{source_id}/{target_id}", response_model=ConnectionExplanation)
def connection(source_id: str, target_id: str):
    c = atlas.explain_connection(source_id, target_id)
    if c is None:
        raise HTTPException(404, "one or both nodes not found")
    return c


@router.get("/edges/{edge_id}", response_model=Edge)
def edge(edge_id: str):
    e = get_store().edges.get(edge_id)
    if e is None:
        raise HTTPException(404, f"edge not found: {edge_id}")
    return e


@router.get("/edges/{edge_id}/judge")
def judge(edge_id: str):
    e = get_store().edges.get(edge_id)
    if e is None:
        raise HTTPException(404, f"edge not found: {edge_id}")
    return get_decision_service().judge_edge(e)


@router.get("/evals", response_model=EvalReport)
def evals(judge: str = Query("mock", pattern="^(mock|laya|openai|laya-v2|openai-v2)$")):
    return run_evals(judge)


@router.get("/question-packs")
def question_packs():
    return get_decision_service().packs
