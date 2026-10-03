"""Rare Disease Atlas API. Demo data only; see data/generate_mock_data.py."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers.api import router

app = FastAPI(title="Rare Disease Atlas API", version="0.1.0",
              description="Prototype backed by synthetic demonstration data.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok", "data": "synthetic-demo"}
