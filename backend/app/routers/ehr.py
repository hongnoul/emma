"""EHR endpoints: SMART on FHIR launch config + stateless Bundle analysis.

No PHI is stored. Bundle bodies are processed in-memory per request and
never logged. Disable access-log bodies for /v1/ehr/* in production.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..connectors import fhir as _fhir

router = APIRouter(prefix="/v1/ehr", tags=["ehr"])


class SmartConfig(BaseModel):
    smart_app_url: str
    fhir_version: str = "R4"
    launch_modes: list[str] = ["ehr-launch", "standalone-launch"]
    scopes: str = ("launch openid fhirUser patient/Patient.read "
                   "patient/Condition.read patient/Observation.read "
                   "patient/FamilyMemberHistory.read patient/MedicationRequest.read "
                   "patient/DocumentReference.read")
    atlas_analyze_endpoint: str = "/v1/ehr/analyze-bundle"
    launch_shim: str = "/ehr-launch.html"
    issuer_note: str = ("Register the launch_shim URL as the SMART redirect URI "
                        "in each hospital EHR (Epic/Oracle/Meditech). Same build, new client ID.")


@router.get("/smart-config", response_model=SmartConfig)
def smart_config():
    api_base = os.environ.get("ATLAS_PUBLIC_BASE", "https://rare-disease-atlas-api.fly.dev")
    web_base = os.environ.get("ATLAS_WEB_BASE", "https://rare-disease-atlas-khaki.vercel.app")
    return SmartConfig(smart_app_url=f"{web_base}/ehr-launch.html",
                       atlas_analyze_endpoint=f"{api_base}/v1/ehr/analyze-bundle")


@router.get("/status")
def status():
    return {"ehr": "connectable",
            "method": "SMART on FHIR R4",
            "phi_storage": "none (in-memory per request)",
            "writes_to_chart": False}


@router.post("/analyze-bundle")
def analyze_bundle(bundle: dict):
    """Accept any FHIR R4 Bundle (or single resource) from the SMART shim,
    return candidate codes + suggested /v1/entities queries."""
    if not isinstance(bundle, dict):
        raise HTTPException(400, "body must be a FHIR JSON object")
    try:
        result = _fhir.analyze_bundle(bundle)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return result
