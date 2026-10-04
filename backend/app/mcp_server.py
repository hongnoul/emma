"""Emmatics MCP server.

Exposes the same service layer as the REST API as MCP tools, so agents are
first-class clients alongside browser frontends.

Run (stdio, for Claude Desktop / local agents):
    cd backend && .venv/bin/python -m app.mcp_server

Run (HTTP/SSE, for remote agents once deployed):
    .venv/bin/python -m app.mcp_server --http --port 8001

Env: ATLAS_GRAPH_PATH / ATLAS_DATA_DIR as for the API; ATLAS_JUDGE=laya to
enable the atlas_judge tool with the real model.
"""
from __future__ import annotations

import os

from fastmcp import FastMCP

from .services import atlas
from .services.evals import run_evals
from .services.graph_store import get_store

mcp = FastMCP(
    "emmatics",
    instructions=(
        "Evidence-backed rare-disease knowledge graph. Diseases, genes, and "
        "phenotypes are connected by typed edges; inferred connections carry "
        "calibrated probabilities (edge_valid) from a decision model plus the "
        "evidence snippet they were judged on. Always check atlas_evals to "
        "understand how much to trust the probabilities. Nothing returned is "
        "medical advice."
    ),
)


@mcp.tool
def atlas_search(query: str, types: str = "", limit: int = 10) -> dict:
    """Resolve a query to entities (Disease, Gene, Phenotype...). Returns
    matches with hierarchy context (parents, subtype_count) and per-relation
    connection counts so you can pick the best-connected node."""
    store = get_store()
    ql = query.lower().strip()
    want = {t.strip() for t in types.split(",") if t.strip()}
    out = []
    for n in store.nodes.values():
        if want and n.type not in want:
            continue
        if ql in n.name.lower() or (n.synonyms and any(ql in s.lower() for s in n.synonyms)):
            parents = [store.nodes[e.target].name for e in store.edges_out(n.id, "SUBTYPE_OF")
                       if e.target in store.nodes]
            out.append({"id": n.id, "type": n.type, "name": n.name,
                        "parents": parents[:3],
                        "connections": store.adjacency_summary(n.id)})
        if len(out) >= limit:
            break
    return {"generation_id": store.generation, "items": out}


@mcp.tool
def atlas_get(curie: str) -> dict:
    """Fetch one entity by CURIE (e.g. MONDO:0008062, HP:0002524) with its
    description and adjacency summary."""
    store = get_store()
    n = store.get_node(curie)
    if n is None:
        return {"error": f"not found: {curie}"}
    return {"generation_id": store.generation, "node": n.model_dump(),
            "connections": store.adjacency_summary(curie)}


@mcp.tool
def atlas_connections(curie: str, rel_types: str = "", min_confidence: float = 0.0,
                      limit: int = 25) -> dict:
    """Edges touching an entity. rel_types: comma-separated filter, e.g.
    'PHENOTYPE_SIMILAR,SHARES_GENE_MECHANISM'. min_confidence filters judged
    edges by p(valid); curated edges (no probability) pass unless
    min_confidence > 0."""
    store = get_store()
    rts = [t.strip() for t in rel_types.split(",") if t.strip()] or None
    page, total = store.query_edges(node_id=curie, rel_types=rts,
                                    min_valid=min_confidence if min_confidence > 0 else None,
                                    limit=limit)
    names = {}
    items = []
    for e in page:
        for nid in (e.source, e.target):
            if nid not in names and (n := store.get_node(nid)):
                names[nid] = n.name
        items.append({"id": e.id, "source": e.source, "source_name": names.get(e.source),
                      "target": e.target, "target_name": names.get(e.target),
                      "rel_type": e.rel_type, "provenance": e.provenance,
                      "edge_valid": e.edge_valid, "contradicted": e.contradicted,
                      "description": e.description})
    return {"generation_id": store.generation, "total": total, "items": items}


@mcp.tool
def atlas_explain(from_curie: str, to_curie: str) -> dict:
    """Why are two entities connected? Returns the path, what is known vs
    inferred vs uncertain, and the evidence edges with their states."""
    c = atlas.explain_connection(from_curie, to_curie)
    if c is None:
        return {"error": "one or both nodes not found"}
    return {
        "generation_id": get_store().generation,
        "path": [s.node.name for s in c.path],
        "narrative": c.narrative,
        "known": c.known, "inferred": c.inferred, "uncertain": c.uncertain,
        "evidence": [{"id": e.id, "rel_type": e.rel_type, "provenance": e.provenance,
                      "edge_valid": e.edge_valid, "state": e.state}
                     for e in c.evidence_edges],
    }


@mcp.tool
def atlas_evals(judge: str = "mock") -> dict:
    """Calibration report for the edge judge (accuracy, Brier, ECE,
    reliability bins vs a hand-labeled gold set). judge='laya' scores the
    real zero-shot model. Use this to decide how much to trust edge_valid."""
    r = run_evals(judge)
    return {"generation_id": get_store().generation, **r.model_dump()}


@mcp.tool
def atlas_judge(state: str, pack_id: str = "edge-validate-v1") -> dict:
    """Judge an arbitrary evidence state with a typed question pack using the
    local decision model. Requires ATLAS_JUDGE=laya on this process;
    otherwise returns an explanatory error (stored judgments in the graph
    are unaffected)."""
    if os.environ.get("ATLAS_JUDGE") != "laya":
        return {"error": "on-demand judging disabled (set ATLAS_JUDGE=laya with laya installed); "
                         "stored edge judgments remain available via atlas_connections"}
    from .services.decision_service import get_decision_service
    svc = get_decision_service()
    pack = svc.packs.get(pack_id)
    if pack is None:
        return {"error": f"unknown pack: {pack_id}"}
    result = svc._router.predict(state, pack["questions"])  # type: ignore[attr-defined]
    return {"pack_id": pack_id, "answers": result["answers"]}


@mcp.resource("atlas://generation")
def generation() -> dict:
    """Current graph generation and size."""
    store = get_store()
    return {"generation_id": store.generation, "nodes": len(store.nodes),
            "edges": len(store.edges)}


@mcp.resource("atlas://question-packs")
def question_packs() -> dict:
    """Typed question packs used by the judge."""
    from .services.decision_service import get_decision_service
    return get_decision_service().packs


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--http", action="store_true")
    ap.add_argument("--port", type=int, default=8001)
    args = ap.parse_args()
    if args.http:
        mcp.run(transport="http", host="0.0.0.0", port=args.port)
    else:
        mcp.run()
