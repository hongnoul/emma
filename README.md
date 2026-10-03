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
│   └── gold_labels.json       hand-labeled edge validity for evals
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

## Evals

`backend/app/services/evals.py` scores every judged edge's `edge_valid`
probability against `data/gold_labels.json` (31 hand-labeled edges, including
deliberate traps: confident-but-false edges and a stale legacy annotation).
Metrics: accuracy@0.5, Brier score, ECE with 5 reliability bins.

This harness is the acceptance test for swapping in a real judge: run it
before and after; if ECE worsens, fit a temperature per question pack.

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

## Deployment (prepared, not yet deployed)

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
3. **Laya (calibrated edge judge)** → `backend/app/services/decision_service.py`.
   Already implemented: `backend/.venv/bin/pip install laya` (not in
   requirements.txt, since it pulls torch+transformers, ~2 GB), then run the
   backend with `ATLAS_JUDGE=laya` to judge edges with the real local model.
   `scripts/judge_with_laya.py` batch-judges all edges and writes
   `data/laya_judgments_zeroshot.json`; compare judges with
   `GET /api/evals?judge=laya` vs `GET /api/evals` (a committed copy of the
   zero-shot judgments ships with the repo, so the comparison works without
   installing Laya).
   Measured on this machine (M-series, CPU/MPS): 152 ms/edge for all 4 typed
   questions in one forward pass; zero-shot on the 31-edge demo gold set:
   accuracy 0.742, Brier 0.179, ECE 0.162. Zero-shot misses subtle traps
   (the superseded legacy edge gets p(valid)=0.72), so fine-tune on a real
   gold set and fit per-pack temperatures before gating automation on these
   probabilities. Pipeline: extractor proposes an edge with a `state`
   snippet → `judge_edge()` fills the decision block → eval harness verifies
   calibration against the gold set.
4. **Graph database** → `backend/app/services/graph_store.py`.

## Highest-priority TODOs (mock → real)

1. **Entity resolution first**: implement `MondoConnector` + `HPOConnector`
   to get stable IDs and disease–phenotype edges for one pilot cluster
   (e.g. a real lysosomal disease group). Everything else keys off these IDs.
2. **PubMed ingestion for the pilot cluster**: fetch abstracts, run
   `AIService.extract_relationships` (OpenAI structured output), attach each
   proposed edge's abstract snippet as `state`.
3. **Swap the mock judge for Laya**: `pip install laya`, implement
   `judge_edge` per the docstring, build a ~200-edge real gold set, run the
   eval harness, fit per-pack temperatures.
4. **ClinVar/ClinicalTrials/Orphanet connectors** for variants, studies, and
   patient organizations on the pilot cluster.
5. **Replace similarity stub**: `related_diseases` currently reads stored
   edges; compute candidates from shared pathways/informative phenotypes and
   judge them with the `cluster-membership-v1` pack.
6. **Frontend**: real design system, progressive reveal, edge inspector
   polish; the API contract already supports all of it.
