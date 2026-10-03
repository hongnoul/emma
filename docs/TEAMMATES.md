# Teammate frontend kit (hackathon — backend is fully public, no auth)

Base: `https://rare-disease-atlas-api.fly.dev`
CORS: `*` (any origin, any device, any network). No keys. Just `fetch`.
Spec: `/openapi.json` · Playground: `/docs` · Health: `/health`

## 60-second start (no build needed)

```html
<script>
const API = "https://rare-disease-atlas-api.fly.dev";
const j = (p) => fetch(API + p).then(r => r.json());
// try in any browser console:
j("/v1/entities?q=marfan&limit=3").then(console.log);
j("/v1/paths?from=MONDO:0007947&to=MONDO:0011431").then(console.log);
</script>
```

Or copy `frontend/public/starter.html` — it runs from `file://`, no npm.

## Working anchor IDs (verified live)

- `MONDO:0007947` Marfan syndrome (rich node)
- `MONDO:0011431` related target for path demo
- `MONDO:0018149` GM1 gangliosidosis (Lenia focal)
- `MONDO:0020066` Ehlers-Danlos syndrome

## Parallel lanes (pick one, no coordination needed)

1. **Search + disease page** — `/api/search?q=` → `/api/diseases/{id}` → `/api/diseases/{id}/related`
2. **Graph explorer** — `/api/diseases/{id}/graph?depth=2` (use depth 1-2, NOT `/api/graph` full dump: 84k edges, ~46MB JSON; NOT `/api/graph.gexf`: ~28MB XML for Gephi desktop only)
3. **Why-connected** — `/v1/entities?q=` picker → `/v1/paths?from=&to=` (render `known` vs `inferred` vs `uncertain` chips)
4. **Edge lab** — `/v1/edges?node=&rel_types=&provenance=&min_valid=&limit=` + `/api/edges/{id}` + `/api/edges/{id}/judge`
5. **Evals / trust UI** — `/api/evals?judge=mock`, `/v1/evals`, `/api/question-packs`
6. **Lenia scenes** — see `frontend/app/lenia/page.tsx` + `frontend/lib/lenia-atlas.ts` for mapping patterns (graph stats → seed blobs). Note: that file fetches via a local-dev-only `/prod-api` proxy (`frontend/next.config.ts` rewrites); zero-context agents should fetch `https://rare-disease-atlas-api.fly.dev` directly (CORS `*`), not copy the `/prod-api` prefix.

Full primitive reference: `docs/integration.md` (six `/v1` primitives + worked symptom-search example).
Typed client: `cd frontend && NEXT_PUBLIC_API_BASE=https://rare-disease-atlas-api.fly.dev npm run gen:api` regenerates `lib/api.gen.ts` from live prod OpenAPI (default without the env var points at localhost).

## Gotchas (read before demo)

- Every `/v1` response has `generation_id` — key caches on it, never mix generations.
- Prod bulk graph: `opportunities` returns `[]`, `evals` is `n:0`, most edges lack `p(valid)` — render honest empty states (see Lenia scenes 6-7).
- `POST /v1/judge` returns 501 on prod (no Laya) — degrade gracefully.
- Cold start: Fly keeps 1 machine warm (`min_machines_running = 1`), so prod responds in ms. Still retry once with 15s timeout for safety (see `frontend/lib/api.ts` `get()`).
- Never render `provenance:inferred` as fact. Never treat umbrella `SUBTYPE_OF` parents as one disease.
