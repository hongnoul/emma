# EHR Integration Strategy: claim "works with each hospital's EHR" honestly

Goal: any physician running the Atlas inside their hospital gets patient
context from that hospital's EHR automatically, with one build.

## The one-sentence answer

Build a **SMART on FHIR R4 app**. Do not build Epic integration,
Cerner integration, Meditech integration separately.

By federal rule (ONC 21st Century Cures Act), every certified US hospital
EHR already exposes a FHIR R4 API with a SMART launch. Epic (Hyperspace),
Oracle Health / Cerner (PowerChart), Meditech Expanse all support it.
One SMART build launches inside any of them. That is the entire basis
for the claim "integrates with the EHR of each hospital the physician
runs it in."

What you never do: direct database access, HL7v2 interfaces, VPNs,
per-hospital custom work, storing PHI.

## Architecture (fits the current repo)

```
Hospital EHR (Epic / Oracle / Meditech)
  | SMART launch (patient + encounter context) + OAuth2
  v
Atlas SMART shim (frontend, no PHI stored)
  | FHIR R4 read: Patient, Condition, Observation, FamilyMemberHistory,
  |   MedicationRequest, DocumentReference, MolecularSequence / Genomics
  v
backend/app/connectors/fhir.py  (NEW, scaffolded in this PR)
  | normalize codes -> Atlas entities
  v
existing /v1/* primitives (unchanged)
  Resolve (ICD-10 / SNOMED -> MONDO) -> Traverse -> Path -> Judge -> Evals
```

Key design choice: the FHIR connector only produces **search strings and
code lists** for the existing `/v1/entities` + `/v1/edges` + `/v1/paths`
primitives. No new graph logic. No backend PHI persistence. The Bundle
is analyzed in-memory per request.

Code mapping used:

| FHIR resource | Codes in the wild | Atlas target |
|---|---|---|
| Condition | ICD-10-CM, SNOMED CT | Disease (MONDO) via `/v1/entities?q=` synonym/xref lookup |
| Observation (phenotype, vitals, labs) | LOINC, SNOMED CT | Phenotype (HPO) candidates for symptom-search composition |
| FamilyMemberHistory | SNOMED CT condition | pedigree hint, boosts related-disease ranking |
| MedicationRequest | RxNorm | supporting context in workbench state snippet |
| MolecularSequence / Observation-genetics | HGNC, ClinVar alleles | Gene / Variant nodes |
| Patient | age, sex | audience gating (`researcher` vs `patient` copy) |

ICD-10/SNOMED to MONDO/HPO is intentionally a **candidate proposal**,
not a diagnosis. The judge + trust gate (`/v1/paths` trust block) stays
the decision layer. The physician triage queue stays the human gate.

## What you can claim, and when (claim ladder — stay honest)

- **Today (after this PR merges):** "EHR-connectable via SMART on FHIR
  R4. Launches with patient context from any ONC-certified EHR. No PHI
  stored." Defensible because: `POST /v1/ehr/analyze-bundle` accepts any
  FHIR R4 Bundle, `GET /v1/ehr/smart-config` exposes launch config, and
  the connector maps to existing v1 primitives. Demo against public
  sandboxes.
- **After sandbox validation (~1 day):** "Validated against Epic
  sandbox and SMART Health IT sandbox." Run the shim against
  `https://fhir.epic.com/interconnect-fhir-oauth` (sandbox) and
  `https://launch.smarthealthit.org`. Screenshot the patient-context
  auto-populate. That is the proof most reviewers accept.
- **After one hospital pilot (~2-4 weeks, IT ticket only):**
  "Piloted at [Hospital]: launched from within Hyperspace/PowerChart."
  This needs only an allowlisted redirect URI + client ID. No interface
  engine work.
- **After marketplace listing (~2-3 months):** "Listed on Epic App
  Orchard / Oracle Code program." Needed only for procurement checklists,
  not for technical function.

Never claim "integrated with Epic" without the sandbox screenshot.
Never claim diagnosis. The product proposes candidates with calibrated
probabilities; the physician decides.

## Phased build (cheapest order)

### Phase 0 — this PR (0.5 day, done except sandbox test)
- [x] `backend/app/connectors/fhir.py`: stateless FHIR R4 Bundle parser
- [x] `backend/app/routers/ehr.py`: `POST /v1/ehr/analyze-bundle`,
      `GET /v1/ehr/smart-config`, `GET /v1/ehr/status`
- [ ] `npm i fhirclient` + 60-line SMART launcher page at
      `/physician/ehr` (EHR launch -> get patient ID -> fetch Bundle ->
      POST to analyze-bundle -> render existing triage/path views)

### Phase 1 — sandbox proof (1 day, this is what unlocks the claim)
1. Register a sandbox client on Epic + SMART Health IT launch pad.
2. Launch the shim with `launch` + `patient` context, fetch
   Patient + Condition + Observation for the test patient.
3. POST the Bundle to the deployed Fly API, screenshot phenotypes
   auto-filled and the atlas path explanation with the trust block.
4. Put the two screenshots + sandbox patient ID in the pitch appendix.

Validation status (Oct 2026): endpoint + edge-case suite and the full
Bundle -> entities -> edges -> trust-gated path chain pass on demo and
real graphs (real clinical strings like Niemann-Pick disease,
Splenomegaly, Hepatomegaly resolve to MONDO/HPO; NPC1 resolves to
HGNC). On the production bulk graph the same flow resolves 3/3 test
queries, with one data gap noted: Fabry disease (MONDO:0010526) is
absent from the bulk build (present in the 10-disease real graph) and
should be checked at next bulk rebuild. `scripts/smoke_test.py` covers
the EHR endpoints as regression tests.
**Deploy note: production Fly API predates the EHR routes
(`GET /v1/ehr/status` returns 404 there); redeploy with
`scripts/deploy.sh` to publish them.** No PHI is stored; Bundle bodies
are in-memory only.

### Phase 2 — hospital pilot (IT-light)
- Hospital IT allowlists one redirect URI and issues a client ID
  (confidential or public SMART app, scopes:
  `launch openid fhirUser patient/Patient.read patient/Condition.read
  patient/Observation.read patient/FamilyMemberHistory.read`).
- CDS Hooks is explicitly deferred. Read-only SMART first; no
  back-write to the chart except an optional Clinical Note paste-out.
- BAA posture: Atlas backend processes PHI in-memory only, no storage,
  no logs of resource bodies. Deploy in the hospital's region. Audit
  log is launch event + code counts, never values.

### Phase 3 — marketplaces (only when procurement asks)
- Epic App Orchard + Oracle Health Code program submissions reuse the
  same build. Budget for security questionnaire, not re-engineering.

## Physician workflow (the demo script)

1. Physician opens a patient chart, clicks the Atlas app (EHR launch).
2. Atlas receives patient context, pulls Conditions + Observations.
3. Atlas shows: "Chart suggests 6 phenotype candidates (HPO) + 2
   candidate diseases (MONDO). Accept which ones describe this patient?"
   Physician checks/unchecks (same triage keyboard pattern as now).
4. Accepted phenotypes run the existing symptom-search composition
   (`entities` -> `edges` -> `paths`) and render ranked differentials
   with per-edge gate bands and weakest-link attribution.
5. "Copy note" pastes a citation-backed summary for the chart. Nothing
   is written to the EHR automatically in v1.

## Compliance notes (short version)

- HIPAA: no PHI at rest in Atlas. Bundle bodies are never logged or
  cached; `generation_id` caching keys only graph versions, never
  patients. Disable access logs for `/v1/ehr/*` bodies.
- Safety copy: inferred edges are never rendered as diagnoses. The
  middle-band warning ("Early or limited evidence... Discuss with your
  doctor") already in `docs/integration.md` is the exact copy to reuse
  in the EHR view.
- Genomics: treat MolecularSequence as optional. Phenotype-first flow
  works without it; gene data only narrows candidates.

## What not to build

- No HL7v2, no FHIR write-back, no per-hospital adapters, no PHI
  database, no CDS Hooks trigger in v1. Each of those multiplies
  hospital IT review from days to months with zero demo benefit.
