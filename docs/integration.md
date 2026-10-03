# Integrating a new frontend or agent

The atlas exposes **six generic primitives**; every feature is a composition
of them. You never need a new backend endpoint for a new view.

## Setup (frontend teammate, 3 steps)

```bash
export NEXT_PUBLIC_API_BASE=http://localhost:8000   # or the deployed Fly URL
cd frontend && npm run gen:api                      # TS types from live OpenAPI -> lib/api.gen.ts
# build your pages against /v1/*; done
```

Every `/v1` response includes `generation_id`. Key client caches on it, the
graph is republished atomically and you never want to mix generations.

## The six primitives

| | Endpoint | Use |
|---|---|---|
| Resolve | `GET /v1/entities?q=&types=&limit=` | search any entity; returns match kind, parents (SUBTYPE_OF), subtype_count, per-relation connection counts |
| Fetch | `GET /v1/entities/{curie}` | one node + adjacency summary + hierarchy |
| Traverse | `GET /v1/edges?from=&to=&node=&rel_types=&provenance=&min_valid=&judged_only=&limit=&offset=` | the workhorse: any edge query |
| Path | `GET /v1/paths?from=&to=` | why-connected: route + known/inferred/uncertain + evidence states |
| Judge | `POST /v1/judge {state, pack_id}` | on-demand judgment; 501 unless the deployment runs with ATLAS_JUDGE=laya |
| Evals | `GET /v1/evals?judge=mock\|laya` | calibration report: how much to trust edge_valid |

`GET /v1/meta` lists node/edge type counts for the current generation.

## Worked example: symptom search (no backend changes)

```ts
// 1. resolve the symptom
const ph = await get(`/v1/entities?q=cataplexy&types=Phenotype`);
const hp = ph.items[0].node.id;                       // "HP:0002524"

// 2. diseases presenting it
const dz = await get(`/v1/edges?to=${hp}&rel_types=HAS_PHENOTYPE&limit=50`);
// -> narcolepsy 1/3/7, Niemann-Pick C1, ...

// 3. for any hit, its judged connections above a confidence bar
const rel = await get(`/v1/edges?node=${dz.items[0].source}` +
                      `&rel_types=PHENOTYPE_SIMILAR&min_valid=0.8`);

// 4. explain one
const why = await get(`/v1/paths?from=${a}&to=${b}`);
```

## Reading an edge

```jsonc
{
  "rel_type": "PHENOTYPE_SIMILAR",   // channel: amber (judged) in the reference UI
  "provenance": "inferred",          // NEVER render inferred as fact
  "edge_valid": 0.90,                // p(connection holds), calibration via /v1/evals
  "contradicted": 0.004,             // p(contradicting evidence) — warn if high
  "evidence_level": {...},           // distribution over hypothesis..clinical
  "state": "...",                    // exact evidence text the judge read — show on click
  "decision_meta": {...}             // which model/pack/when — provenance
}
```

Channel semantics: `SHARES_GENE_MECHANISM` is curated (no probability, the
shared gene is the proof); `PHENOTYPE_SIMILAR` is judged inference;
`SUBTYPE_OF` is MONDO hierarchy (aggregate subtypes at render time, never
treat an umbrella disease as one biological entity); `HAS_PHENOTYPE` /
`CAUSED_BY` are curated annotations.

## MCP (agents)

Same capabilities as tools: `atlas_search, atlas_get, atlas_connections,
atlas_explain, atlas_evals, atlas_judge`.

```bash
cd backend && .venv/bin/python -m app.mcp_server          # stdio
.venv/bin/python -m app.mcp_server --http --port 8001     # HTTP for remote
```

Claude Desktop config:

```json
{"mcpServers": {"atlas": {
  "command": "/path/to/emma/backend/.venv/bin/python",
  "args": ["-m", "app.mcp_server"],
  "cwd": "/path/to/emma/backend",
  "env": {"ATLAS_GRAPH_PATH": "data/graph.bulk.json"}
}}}
```

## Legacy endpoints

`/api/*` (disease-page shaped) remain for the reference frontend; new work
should target `/v1/*`.
