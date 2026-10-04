"""Voice endpoints for the ElevenLabs Conversational AI patient agent.

Two jobs:
 1. /v1/voice/signed-url — mint a short-lived WebRTC signed URL so the
    browser never sees ELEVENLABS_API_KEY.
 2. /v1/voice/tools/* — server-tool webhooks the agent calls mid-turn.
    Every disease claim is routed through the patient-audience trust gate
    (services/trust.py) so the voice agent inherits the same safety layer
    as the visual UI: suppressed edges are never spoken.

Env:
  ELEVENLABS_API_KEY   required for signed-url
  ELEVENLABS_AGENT_ID  required for signed-url (agent configured in dashboard)
"""
from __future__ import annotations

import os
import urllib.request
import json as _json

from fastapi import APIRouter, HTTPException, Query

from ..services import trust as _trust
from ..services.graph_store import get_store
from ..services import knowledge

router = APIRouter(prefix="/v1/voice", tags=["voice"])

_EL_BASE = "https://api.elevenlabs.io/v1"


@router.get("/status")
def status():
    return {
        "configured": bool(os.environ.get("ELEVENLABS_API_KEY")
                           and os.environ.get("ELEVENLABS_AGENT_ID")),
        "agent_id_set": bool(os.environ.get("ELEVENLABS_AGENT_ID")),
        "api_key_set": bool(os.environ.get("ELEVENLABS_API_KEY")),
        "tools": ["/v1/voice/tools/emmatics-brief"],
    }


@router.get("/signed-url")
def signed_url():
    """Short-lived signed URL for the browser SDK. Keeps the key server-side."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID")
    if not api_key or not agent_id:
        raise HTTPException(503, "voice not configured: set ELEVENLABS_API_KEY "
                                 "and ELEVENLABS_AGENT_ID")
    req = urllib.request.Request(
        f"{_EL_BASE}/convai/conversation/get-signed-url?agent_id={agent_id}",
        headers={"xi-api-key": api_key})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = _json.loads(r.read())
    except Exception as e:  # noqa: BLE001 — surface upstream failure as 502
        raise HTTPException(502, f"elevenlabs signed-url failed: {e}")
    return {"signed_url": body.get("signed_url"), "agent_id": agent_id}


@router.get("/token")
def webrtc_token():
    """Short-lived WebRTC conversation token. WebRTC gives the browser native
    mic capture, echo cancellation, and audio playback — more reliable than
    the websocket transport across browsers (Safari in particular)."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    agent_id = os.environ.get("ELEVENLABS_AGENT_ID")
    if not api_key or not agent_id:
        raise HTTPException(503, "voice not configured: set ELEVENLABS_API_KEY "
                                 "and ELEVENLABS_AGENT_ID")
    req = urllib.request.Request(
        f"{_EL_BASE}/convai/conversation/token?agent_id={agent_id}",
        headers={"xi-api-key": api_key})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = _json.loads(r.read())
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"elevenlabs token failed: {e}")
    return {"token": body.get("token"), "agent_id": agent_id}


# ---------------------------------------------------------------- agent tools

@router.get("/tools/atlas-brief", include_in_schema=False)  # legacy alias
@router.get("/tools/emmatics-brief")
def atlas_brief(q: str = Query(..., min_length=1),
                max_facts: int = Query(6, ge=1, le=12)):
    """One-shot voice-friendly brief: search → detail → patient-gated evidence.

    Returns short plain-text `spoken_brief` plus structured facts. Designed as
    a single ElevenLabs server tool so the agent makes one webhook call per
    question instead of chaining search/detail/evidence.
    """
    store = get_store()
    hits = knowledge.search(q)
    hit = next((h for h in hits if h.type == "Disease"), hits[0] if hits else None)
    if hit is None:
        return {"found": False,
                "spoken_brief": f"I couldn't find anything in Emmatics matching {q}."}
    detail = knowledge.disease_detail(hit.id) if hit.type == "Disease" else None

    # Patient-gated evidence: only speak edges the trust layer would show
    # to a patient (band 'established'/'supported' per gate action).
    facts: list[dict] = []
    for e in store.edges_touching(hit.id):
        ev = e.evidence_level.expected if e.evidence_level else None
        pack = e.decision_meta.question_pack if e.decision_meta else "edge-validate-v1"
        g = _trust.gate(e.edge_valid, e.contradicted, ev, pack,
                        audience="patient", provenance=e.provenance)
        if g.get("action") == "show" and e.description:
            facts.append({"text": e.description,
                          "band": g.get("band"),
                          "rel_type": e.rel_type,
                          "source_db": e.source_db})
        if len(facts) >= max_facts:
            break

    parts = [f"{hit.name}."]
    if detail:
        genes = ", ".join(g.name for g in (detail.genes or [])[:4])
        phenos = ", ".join(p.name for p in (detail.phenotypes or [])[:4])
        if genes:
            parts.append(f"Linked genes include {genes}.")
        if phenos:
            parts.append(f"Common phenotypes include {phenos}.")
        n_pubs = len(detail.publications or []) + len(detail.studies or [])
        if n_pubs:
            parts.append(f"Emmatics links {n_pubs} publications and studies.")
    if facts:
        parts.append("Patient-vetted evidence: " +
                     " ".join(f["text"].rstrip(".") + "." for f in facts[:3]))
    else:
        parts.append("No evidence for this has passed the patient trust gate yet, "
                     "so I can only describe it generally.")

    return {"found": True, "id": hit.id, "name": hit.name, "type": hit.type,
            "spoken_brief": " ".join(parts),
            "facts": facts,
            "gate": "audience=patient (established-only at high confidence)"}
