"""Rare Disease Atlas API. Demo data only; see data/generate_mock_data.py."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.api import router
from .routers.v1 import router as v1_router

app = FastAPI(title="Rare Disease Atlas API", version="0.1.0",
              description="Prototype backed by synthetic demonstration data.")
import os
_raw = os.environ.get("ATLAS_CORS_ORIGINS", "*")
_origins = ["*"] if _raw.strip() == "*" else [o.strip() for o in _raw.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
app.include_router(v1_router)


@app.get("/", include_in_schema=False)
def root():
    return {
        "service": "Rare Disease Atlas API",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "meta": "/v1/meta",
        "health": "/health",
        "try": [
            "/v1/entities?q=marfan",
            "/v1/edges?node=MONDO:0007947&limit=5",
            "/v1/paths?from=MONDO:0007947&to=MONDO:0011431",
            "/api/diseases/MONDO:0007947/graph?depth=2",
        ],
        "frontend_demo": "https://rare-disease-atlas-khaki.vercel.app/disease/MONDO:0007947",
    }


@app.get("/health")
def health():
    import json as _json
    import os as _os
    from .services.graph_store import get_store, DATA_DIR
    store = get_store()
    gp = _os.environ.get("ATLAS_GRAPH_PATH", "data/graph.json (demo)")
    return {"status": "ok", "graph": gp, "nodes": len(store.nodes), "edges": len(store.edges)}
