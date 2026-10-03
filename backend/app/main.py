"""Rare Disease Atlas API. Demo data only; see data/generate_mock_data.py."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.api import router
from .routers.v1 import router as v1_router

app = FastAPI(title="Rare Disease Atlas API", version="0.1.0",
              description="Prototype backed by synthetic demonstration data.")
import os
_origins = os.environ.get("ATLAS_CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=_origins,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)
app.include_router(v1_router)


@app.get("/health")
def health():
    import json as _json
    import os as _os
    from .services.graph_store import get_store, DATA_DIR
    store = get_store()
    gp = _os.environ.get("ATLAS_GRAPH_PATH", "data/graph.json (demo)")
    return {"status": "ok", "graph": gp, "nodes": len(store.nodes), "edges": len(store.edges)}
