"""FHIR R4 connector: stateless EHR Bundle -> Atlas query candidates.

This is the entire EHR integration surface. The hospital EHR (Epic,
Oracle Health, Meditech — all ONC-certified) exposes FHIR R4 + SMART
launch. A thin SMART shim fetches the patient Bundle and POSTs it to
/v1/ehr/analyze-bundle. This module parses the Bundle in-memory and
returns *candidate codes + suggested Atlas /v1 queries*. It never stores
PHI, never writes to the chart, and performs no diagnosis.

Reading this Bundle requires no new dependencies: plain dict traversal.
"""
from __future__ import annotations

# Coding systems seen in US hospital FHIR output.
SYSTEM_HINTS = {
    "http://hl7.org/fhir/sid/icd-10-cm": "icd10",
    "http://hl7.org/fhir/sid/icd-10": "icd10",
    "http://snomed.info/sct": "snomed",
    "http://loinc.org": "loinc",
    "http://www.nlm.nih.gov/research/umls/rxnorm": "rxnorm",
    "http://human-phenotype-ontology.org": "hpo",
    "http://www.genenames.org": "hgnc",
    "http://hl7.org/fhir/sid/hgnc": "hgnc",
}

# Resource types we read. Everything else is ignored (never logged).
READ_RESOURCES = {
    "Patient",
    "Condition",
    "Observation",
    "FamilyMemberHistory",
    "MedicationRequest",
    "MolecularSequence",
    "DocumentReference",
}


def _codings(code_obj: dict | None) -> list[dict]:
    if not isinstance(code_obj, dict):
        return []
    out = []
    for c in code_obj.get("coding", []) or []:
        system = c.get("system", "")
        out.append({
            "system": system,
            "system_hint": SYSTEM_HINTS.get(system, system.split("/")[-1] or "unknown"),
            "code": c.get("code", ""),
            "display": c.get("display", ""),
        })
    return out


def _resources(bundle: dict) -> list[dict]:
    entries = bundle.get("entry", []) if isinstance(bundle, dict) else []
    resources = []
    for e in entries:
        r = (e or {}).get("resource", {})
        if isinstance(r, dict) and r.get("resourceType") in READ_RESOURCES:
            resources.append(r)
    # Also accept a bare resource (single Patient/Condition POSTed alone).
    if not resources and isinstance(bundle, dict) and bundle.get("resourceType") in READ_RESOURCES:
        resources.append(bundle)
    return resources


def analyze_bundle(bundle: dict) -> dict:
    """Parse a FHIR R4 Bundle (or single resource) into Atlas candidates.

    Returns JSON-safe dict with no raw narrative text, only codes/displays
    needed to build /v1/entities queries. Raises ValueError on bad input.
    """
    if not isinstance(bundle, dict):
        raise ValueError("bundle must be a JSON object")
    resources = _resources(bundle)
    if not resources:
        raise ValueError("no readable FHIR resources found (need Patient/Condition/Observation/...)")

    patient: dict = {}
    conditions: list[dict] = []
    phenotypes: list[dict] = []
    genes: list[dict] = []
    meds = 0
    family = 0
    doc_count = 0

    for r in resources:
        rt = r.get("resourceType")
        if rt == "Patient":
            patient = {
                "id": r.get("id", ""),
                "sex": r.get("gender", ""),
                "birthDate": r.get("birthDate", ""),
            }
        elif rt == "Condition":
            for c in _codings(r.get("code")):
                conditions.append({**c, "clinicalStatus": str((r.get("clinicalStatus") or {}).get("coding", [{}])[0].get("code", ""))})
        elif rt == "Observation":
            # Genetic observations carry gene/variant info; everything else
            # is a phenotype/lab candidate via its code + valueCodeableConcept.
            cat = str(r.get("category", ""))
            is_genetics = "genetic" in cat.lower() or "molecular" in str(r.get("code", "")).lower()
            for c in _codings(r.get("code")):
                (genes if is_genetics else phenotypes).append({**c, "from": "observation.code"})
            for vc in _codings(r.get("valueCodeableConcept")):
                phenotypes.append({**vc, "from": "observation.value"})
        elif rt == "FamilyMemberHistory":
            family += 1
            for cond in r.get("condition", []) or []:
                for c in _codings(cond.get("code")):
                    phenotypes.append({**c, "from": "familyHistory"})
        elif rt == "MedicationRequest":
            meds += 1
        elif rt == "MolecularSequence":
            genes.append({"system": "", "system_hint": "sequence",
                          "code": r.get("id", ""), "display": "molecular sequence"})
        elif rt == "DocumentReference":
            doc_count += 1

    # Deduplicate by (system, code, display).
    def _dedup(items: list[dict]) -> list[dict]:
        seen, out = set(), []
        for i in items:
            k = (i.get("system_hint"), i.get("code"), i.get("display"))
            if k not in seen and (i.get("code") or i.get("display")):
                seen.add(k)
                out.append(i)
        return out[:50]

    conditions, phenotypes, genes = _dedup(conditions), _dedup(phenotypes), _dedup(genes)

    # Suggested Atlas queries: display text first (synonym matching in
    # /v1/entities handles lay terms), code as fallback.
    def _q(item: dict, types: str, reason: str) -> dict:
        return {"q": item.get("display") or item.get("code", ""),
                "types": types, "reason": reason,
                "source_code": f"{item.get('system_hint')}:{item.get('code')}"}

    atlas_queries = (
        [_q(c, "Disease", "chart condition -> MONDO candidate") for c in conditions[:10]]
        + [_q(p, "Phenotype", "chart observation -> HPO candidate") for p in phenotypes[:15]]
        + [_q(g, "Gene", "chart genetics -> HGNC candidate") for g in genes[:10]]
    )
    atlas_queries = [q for q in atlas_queries if q["q"]][:30]

    warnings = []
    if not conditions and not phenotypes:
        warnings.append("Bundle has no Condition/Observation codes; check SMART scopes include patient/Condition.read and patient/Observation.read.")
    if len(resources) >= 200:
        warnings.append("Large Bundle truncated to first 50 candidates per class; narrow the SMART query by category.")

    return {
        "patient": patient,
        "counts": {"resources": len(resources), "medications": meds,
                   "familyHistoryEntries": family, "documents": doc_count},
        "condition_candidates": conditions,
        "phenotype_candidates": phenotypes,
        "gene_candidates": genes,
        "atlas_queries": atlas_queries,
        "disclaimer": ("Candidate proposals for physician review, not diagnoses. "
                       "Confirm phenotypes with the patient; gate differentials on /v1/paths trust bands."),
    }
