# Rare Disease Atlas

Prototype knowledge-graph atlas connecting rare diseases through genes,
phenotypes, mechanisms, pathways, publications, studies, researchers,
patient organizations, and reusable research assets.

**All data is synthetic demonstration data** (`DEMO-*` identifiers). No
publication, study, person, or organization in this repo is real.

## Architecture

```
rare-disease-atlas (this repo)
├── data/                      canonical dataset + generator
│   ├── generate_mock_data.py  regenerates everything below (seeded, deterministic)
│   ├── graph.json             nodes + edges (Laya-ready evidence schema)
│   ├── question_packs.json    typed-question definitions for the edge judge
│   └── expert_labels.json   domain-expert overlay (soft targets, overrides) for evals
├── backend/                   FastAPI (Python)
│   └── app/
│       ├── main.py            app entry, CORS
│       ├── routers/api.py     all endpoints
│       ├── models/schemas.py  Pydantic models (the data contract)
│       ├── services/
│       │   ├── graph_store.py       data access (swap for Neo4j here)
│       │   ├── atlas.py             domain queries (search, related, paths, opportunities)
│       │   ├── ai_service.py        OpenAI seam (mock templates today)
│       │   ├── decision_service.py  Laya seam (replays stored judgments today)
│       │   └── evals.py             accuracy / Brier / ECE harness
│       └── connectors/        documented stubs: MONDO, HPO, ClinVar, PubMed,
│                              ClinicalTrials.gov, Open Targets, Monarch, Orphanet
└── frontend/                  Next.js + TypeScript + Tailwind + sigma.js/graphology (Gephi ecosystem)
    └── (intentionally minimal; see "Frontend philosophy")
```

### Layering

Routers → services → graph store. Nothing above `graph_store.py` reads
`graph.json`. To adopt Neo4j, reimplement `GraphStore` with the same method
signatures and point `get_store()` at it.

## Running

Backend (Python 3.11+):

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
# docs at http://localhost:8000/docs
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev
# http://localhost:3000 (expects backend on :8000)
```

Regenerate data (deterministic, seeded):

```bash
python3 data/generate_mock_data.py
```

Run evals standalone:

```bash
cd backend && .venv/bin/python -m app.services.evals
```

Tests (both expect the stack running):

```bash
python3 scripts/smoke_test.py        # 21 API/journey/evidence checks
node scripts/e2e_graph_click.mjs     # graph interaction E2E (needs Brave or Chrome)
```

Or start everything with `scripts/dev.sh`.

## Data model

Node types: `Disease, Gene, Variant, Phenotype, Mechanism, Pathway,
Publication, ClinicalTrial, Researcher, PatientOrganization, ResearchAsset`.

Edge types (closed enum): `CAUSED_BY, HAS_VARIANT, HAS_PHENOTYPE,
AFFECTS_PATHWAY, HAS_MECHANISM, STUDIED_IN, SUPPORTED_BY, AUTHORED_BY,
HAS_ASSET, SHARES_MECHANISM, RELATED_TO`.

### Evidence schema (the important part)

Every edge carries provenance (`curated` from a source DB vs `inferred` by
the atlas). Judged edges additionally carry a **decision block**, which is
deliberately shaped like the output of a calibrated typed-decision model
(Laya / Jev-class "System One" models):

```jsonc
{
  "rel_type": "SHARES_MECHANISM",          // closed enum, never free text
  "provenance": "inferred",
  "rel_probs": {                            // choice: distribution over relationship classes
    "asserted": 0.84, "weaker_association": 0.09,
    "different_relationship": 0.05, "unsupported": 0.02
  },
  "evidence_level": {                       // score: ordered evidence ladder
    "expected": 2.3,
    "probs": {"hypothesis": 0.04, "supported": 0.18, "replicated": 0.61, "clinical": 0.17}
  },
  "contradicted": 0.07,                     // noul: p(contradictory evidence)
  "edge_valid": 0.88,                       // noul: p(the edge holds)
  "state": "…self-contained evidence snippet…",  // what the judge read
  "decision_meta": {"model": "mock-judge-v0", "question_pack": "edge-validate-v1", "judged_at": "…"},
  "supporting_publications": ["DEMO-PUB-003"],
  "contradictory_evidence": ["DEMO-PUB-010"]
}
```

Why distributions instead of a single `confidence` float: they are gateable
(auto-accept > 0.9, human review 0.6–0.9, hide < 0.5), auditable, and
recalibratable after the fact. The UI never presents inferred edges as facts.

`question_packs.json` defines the typed questions the judge answers; the
mock data generator, the decision service, and future Laya calls all share it.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/search?q=` | entities matching a query |
| `GET /api/graph` | full graph |
| `GET /api/graph.gexf` | GEXF export for Gephi desktop (File > Open) |
| `GET /api/diseases/{id}` | disease detail (genes, phenotypes, research, assets…) |
| `GET /api/diseases/{id}/related` | related diseases with shared features + connecting edge |
| `GET /api/diseases/{id}/graph?depth=` | neighborhood subgraph for Cytoscape |
| `GET /api/diseases/{id}/evidence` | all edges touching the disease |
| `GET /api/diseases/{id}/opportunities` | research-opportunity cards (not medical advice) |
| `GET /api/connections/{a}/{b}` | path + known/inferred/uncertain + narrative |
| `GET /api/edges/{id}` | one edge with full decision block |
| `GET /api/edges/{id}/judge` | decision-service judgment for an edge |
| `GET /api/evals` | accuracy, Brier, ECE, reliability bins vs gold labels |
| `GET /api/question-packs` | typed-question definitions |

## Evals + Trust layer

`backend/app/services/evals.py` scores every judged edge's `edge_valid`
probability against `data/expert_labels.json` (domain-expert overlay, Oct 2026:
31 edges, 3 contested with soft targets, 3 expert overrides of the demo gold)
falling back to `data/gold_labels.json`. Metrics: accuracy@0.5, Brier, soft-Brier
(vs 0.5 contested targets), ECE with 5 reliability bins, per-judge temperature
(NLL grid search), zombie-trap pass rate (`data/trap_suite.json`, 5 patterns),
90%-precision gate with abstention rate, and expert-cost accounting (FP=3, FN=1).

Measured (expert-validated, demo n=31):

| Judge | Acc | Brier | ECE | Traps | Cost@0.5 |
|---|---|---|---|---|---|
| mock | 0.935 | 0.089 | 0.133 | 3/5 | 6.0 |
| laya v1 | 0.774 | 0.153 | 0.130 | 1/5 | 15.0 |
| openai v1 | 0.968 | 0.035 | 0.041 | 5/5 | 1.0 |
| openai v2 | 0.968 | 0.035 | — | 5/5 | 1.0 |

`GET /v1/evals?judge=mock|laya|openai|laya-v2|openai-v2` returns the full report
plus `policy` (90/40 thresholds, 3:1 costs, contested edge IDs). `GET /v1/paths`
returns per-edge gate actions plus `p_path` with weakest-link attribution;
`?audience=patient` applies the stricter gate (established only at ≥0.90 with
replicated evidence, hidden below 0.40).

`backend/app/services/trust.py` is the policy module: temperature scaling,
conformal-style precision gating, cost-sensitive decisions, path propagation.
`edge-validate-v2` pack splits supported into model-only/patient and adds a
`superseded` question for zombie knowledge; committed v2 judgments
(`data/openai_judgments_v2.json`, `data/laya_judgments_v2.json`) show OpenAI
flagging all zombie traps superseded≥0.90 while Laya misses them.

This harness is the acceptance test for swapping in a real judge: run it
before and after; if ECE worsens, fit a temperature per question pack.
Thresholds are small-sample estimates until the ~200-edge real gold set lands.

## Frontend philosophy

The frontend is **intentionally minimal**: one API client file, five thin
pages, no component library, no state management, almost no components. It
exists to prove the backend contract end to end and to be replaced or
extended by whoever owns the UI next. Everything interesting lives in the
backend and the data model.

Pages: `/` (search) · `/disease/[id]` · `/graph/[id]` (sigma.js, ForceAtlas2) ·
`/connection/[a]/[b]` · `/opportunities/[id]` · `/evals`.

## Real data (Phase 1 pipeline, working)

`backend/pipeline/` implements the Phase 1 slice of the ingestion design:
Monarch Initiative v3 (aggregating MONDO, OMIM, Orphanet, HPOA) + PubMed
E-utilities, for a 10-disease lysosomal storage cluster.

```bash
cd backend && .venv/bin/python -m pipeline.run        # fetch->judge->gate->publish
# (--no-judge to skip Laya; --refresh to bypass the raw cache in data/raw/)
ATLAS_GRAPH_PATH=data/graph.real.json .venv/bin/uvicorn app.main:app --port 8000
```

Produces `data/graph.real.json` (~210 nodes: real MONDO diseases, HGNC genes,
HPO phenotypes with frequency, live PubMed publications) with
SHARES_MECHANISM candidates derived from phenotype overlap and judged by
local Laya. Generations are archived under `data/generations/`. The default
`data/graph.json` demo dataset is untouched; switch via the env var.

## Bulk graph: all annotated rare diseases (working)

`backend/pipeline/bulk_run.py` builds the full-scale disease-centric graph
from official ontology releases (mondo.obo, hp.obo, phenotype.hpoa,
genes_to_disease.txt in `data/raw/bulk/`):

- 12,054 annotated rare diseases (MONDO spine, OMIM/Orphanet xref-reconciled)
- Two parallel disease-disease channels per the product design:
  `SHARES_GENE_MECHANISM` (curated causal-gene overlap, hierarchy-filtered)
  and `PHENOTYPE_SIMILAR` (IC-weighted phenotype overlap, judged by local
  Laya; 2,882 candidates judged in ~6 min, checkpointed to
  `data/raw/bulk/judgments.jsonl` for resumable runs)
- Disease→phenotype edges are intentionally not materialized in the bulk
  view; shared phenotypes live inside each edge's `state` snippet

```bash
cd backend && .venv/bin/python -m pipeline.bulk_run     # --no-judge / --max-judge N
ATLAS_GRAPH_PATH=data/graph.bulk.json .venv/bin/uvicorn app.main:app
```

The graph view hides Phenotype/Publication nodes by default (toggle chips to
re-show) and colors edges by channel: amber = judged phenotype similarity,
blue = shared gene.

## v1 API + MCP (the integration layer)

Six generic primitives under `/v1/*` (entities, edges, paths, judge, evals,
meta) with `generation_id` on every response, plus an MCP server exposing
the same capabilities as agent tools (`backend/app/mcp_server.py`).
**`docs/integration.md` is the guide for teammates building new frontends
or agents** — including the symptom-search worked example that needs zero
backend changes, and `npm run gen:api` for TypeScript types generated from
the live OpenAPI schema.

## Deployment (LIVE)

- **API**: https://rare-disease-atlas-api.fly.dev (`/docs`, `/v1/meta`)
- **Frontend**: https://rare-disease-atlas-khaki.vercel.app
- **Hackathon teammate kit**: `docs/TEAMMATES.md` (parallel lanes + anchor IDs) and `frontend/public/starter.html` (zero-build, works from `file://`, no keys)
- Redeploy: `scripts/deploy.sh` (rebuild generation -> `fly deploy`; frontend `vercel --prod`)

### Deployment details

- `Dockerfile`: stateless API image (~305 MB), judgments pre-baked, no model
  at serve time. Verified locally with `docker build` + `docker run`.
- `fly.toml`: Fly.io config (shared-cpu-1x, 512 MB, scale-to-zero).
- `scripts/deploy.sh`: rebuild generation -> `fly deploy` -> Vercel notes.
- Frontend: deploy `frontend/` to Vercel with
  `NEXT_PUBLIC_API_BASE=https://<app>.fly.dev`; set `ATLAS_CORS_ORIGINS`
  on the API to the Vercel domain.
- `/health` reports which graph generation is being served.

## Continuous ingestion (design)

`docs/ingestion-pipeline.md` is the production design for the fetch→parse→
reconcile→judge→gate→publish pipeline over the challenge's data sources,
including build phases. Phase 1 (one-cluster vertical slice) is the next
build target; the connector stubs below are its skeleton.

## Where real integrations plug in

1. **Biomedical data** → `backend/app/connectors/` documents each source
   (MONDO, HPO, ClinVar, PubMed, ClinicalTrials.gov, Open Targets, Monarch,
   Orphanet) and the Node/Edge shape it must produce.
2. **OpenAI** → `backend/app/services/ai_service.py`. Five methods with
   `TODO(openai)` markers: extraction, reconciliation, connection narration,
   evidence summaries, opportunity generation. No key needed today.
3. **Calibrated edge judge** → `backend/app/services/decision_service.py`.
   Two real judges are implemented behind the `ATLAS_JUDGE` env var:
   - **OpenAI (default for the challenge)**: `ATLAS_JUDGE=openai` with
     `OPENAI_API_KEY` set. Each pack question becomes one single-token
     Chat Completions call with `logprobs`; the `top_logprobs` mass is
     renormalized over the valid answers to recover a probability
     distribution (`backend/app/services/openai_judge.py`). Default model
     `gpt-4o-mini` (override `ATLAS_OPENAI_MODEL`); spend is estimated per
     call and hard-capped by `ATLAS_OPENAI_BUDGET_USD` (default $5).
     `scripts/judge_with_openai.py` batch-judges the demo edges
     (~$0.002, 9 s) and writes `data/openai_judgments_zeroshot.json`
     (`--pack edge-validate-v2 --out openai_judgments_v2.json` for the
     5-level ladder + superseded signal).
     Expert-validated on the 31-edge overlay: accuracy 0.968, Brier 0.035,
     ECE 0.041, 5/5 zombie traps killed — and v2 flags every zombie trap
     superseded ≥ 0.90.
   - **Laya (local baseline)**: `backend/.venv/bin/pip install laya` (not in
     requirements.txt, since it pulls torch+transformers, ~2 GB), then run
     with `ATLAS_JUDGE=laya`. `scripts/judge_with_laya.py` writes
     `data/laya_judgments_zeroshot.json`. Measured here (M-series, CPU/MPS):
     167 ms/edge for all 5 v2 questions in one forward pass; expert-validated
     accuracy 0.774, Brier 0.153, 1/5 traps — it misses subtle traps
     (the superseded legacy edge gets p(valid)=0.72, superseded=0.61).
   Compare all five with `GET /v1/evals?judge=mock|laya|openai|laya-v2|openai-v2`
   (committed copies of all four zero-shot judgment files ship with the repo, so
   the comparison works without a key or model download). Per-judge
   temperatures are fit automatically against the expert soft targets;
   refit against the ~200-edge real gold set before gating automation.
   Pipeline: extractor proposes an edge with a `state`
   snippet → `judge_edge()` fills the decision block → eval harness verifies
   calibration against the expert-validated set.
4. **Graph database** → `backend/app/services/graph_store.py`.

## Highest-priority TODOs (mock → real)

1. **Entity resolution first**: implement `MondoConnector` + `HPOConnector`
   to get stable IDs and disease–phenotype edges for one pilot cluster
   (e.g. a real lysosomal disease group). Everything else keys off these IDs.
2. **PubMed ingestion for the pilot cluster**: fetch abstracts, run
   `AIService.extract_relationships` (OpenAI structured output), attach each
   proposed edge's abstract snippet as `state`.
3. **Judge selection**: the OpenAI logprobs judge is the default
   (`--judge openai` in the pipeline, `ATLAS_JUDGE=openai` in the API);
   build a ~200-edge real gold set, run the eval harness, fit per-pack
   temperatures. Laya remains available as a local, zero-cost baseline.
4. **ClinVar/ClinicalTrials/Orphanet connectors** for variants, studies, and
   patient organizations on the pilot cluster.
5. **Replace similarity stub**: `related_diseases` currently reads stored
   edges; compute candidates from shared pathways/informative phenotypes and
   judge them with the `cluster-membership-v1` pack.
6. **Frontend**: real design system, progressive reveal, edge inspector
   polish; the API contract already supports all of it.
