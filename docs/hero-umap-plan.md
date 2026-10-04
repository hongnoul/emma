# Physician hero: "Map of rare disease space" (UMAP)

Strategy for the hero component on `/physician` (overview page). Written for the
session building the physician partition. Prod API is the source of truth:
`https://rare-disease-atlas-api.fly.dev` (generation `20261003T224627Z` as of
2026-10-03, 6,097 diseases, 41,791 HAS_PHENOTYPE, 2,882 judged PHENOTYPE_SIMILAR).

## Concept

A full-width interactive scatter of the **4,721 diseases with phenotype
profiles**, each positioned by UMAP
([lmcinnes/umap](https://github.com/lmcinnes/umap)) over its IC-weighted
phenotype profile. Diseases with similar phenotype signatures cluster; the
judged PHENOTYPE_SIMILAR edges draw as faint links **colored by triage band**
(green ≥0.90, amber 0.60–0.90, red <0.60 from `lib/v1.ts` `band()`).

This is not decoration: it is the entry point of the physician flow. The
review-band (amber) links are visually the "frontier" of the map. Clicking a
link opens `/physician/edge/[id]`; clicking a disease opens triage filtered to
that node; a "start triage" CTA floats over the densest amber region. The hero
*shows* why the triage queue exists before the user reads a word.

## Why precompute (not umap-js)

- umap-learn is Python; umap-js exists but 6k × ~8k-dim sparse input in the
  browser is seconds of jank and a different layout every load.
- The graph only changes per generation. Embedding is a build artifact keyed by
  `generation_id`, same pattern the API already uses for cache-keying.

## Pipeline (new script: `backend/pipeline/umap_hero.py`)

1. Pull from prod (paginated `/v1/edges?rel_types=HAS_PHENOTYPE&limit=500`,
   ~84 requests) or read `data/graph.bulk.json` when its `generation_id`
   matches `/v1/meta` — pull from prod by default so the artifact always
   matches what the frontend queries live.
2. Build sparse disease × phenotype matrix. Weight each phenotype by
   information content: `log(N_diseases / df(phenotype))` — mirrors how
   PHENOTYPE_SIMILAR similarity is already computed, so UMAP proximity and
   judged edges will agree visually.
3. `umap.UMAP(metric="cosine", n_neighbors=15, min_dist=0.1, random_state=42)`.
   Deps: `umap-learn scipy scikit-learn` (add to a `requirements-pipeline.txt`,
   not the API image — the API never needs them).
4. Also pull the 2,882 judged edges (`rel_types=PHENOTYPE_SIMILAR&judged_only=true`)
   and keep `{id, source, target, edge_valid}`.
5. Emit `frontend/public/emmatics-umap.json` (~400 KB, gzips well):

```json
{
  "generation_id": "20261003T224627Z",
  "nodes": [{"id": "MONDO:0010070", "n": "brachyolmia type 1...", "x": 1.23, "y": -4.56, "deg": 3}],
  "links": [{"id": "BULK-023613", "s": 0, "t": 1, "v": 0.9529}]
}
```

`s`/`t` are indices into `nodes` to keep the file small. `deg` = judged-edge
degree, used for point sizing.

## Hero component (`frontend/components/EmmaticsHero.tsx`)

- **Renderer: plain `<canvas>` 2D.** 6k points + 3k lines is nothing; no
  deck.gl/regl dependency needed. Draw links first (alpha by `v`, color by
  band), then points (slate dots, sized by `deg`, amber/red-adjacent nodes
  brighter). devicePixelRatio-aware.
- **Interaction:** pointermove hit-test via a quadtree or simple grid bucket →
  tooltip with disease name + judged-neighbor count. Click node →
  `/physician/triage?node=<id>`; click link → `/physician/edge/<id>`. Scroll =
  zoom, drag = pan (single transform matrix, redraw on rAF).
- **Entrance:** points fade/scatter in from center over ~600ms (one-shot
  interpolation from origin to UMAP coords). Cheap, looks expensive.
- **Overlay copy** (left-aligned on top of canvas): headline, live stats from
  `v1.meta()` (already fetched on the page), and the three band counts as
  clickable chips that *highlight the corresponding links on the canvas on
  hover* — this fuses the existing band cards into the hero instead of
  stacking sections.
- **Fallback:** if `emmatics-umap.json` 404s or `generation_id` mismatches
  `v1.meta()`, render the current static header + band cards (zero regression),
  and log a console warning to regenerate the artifact.

## Honest-semantics guardrail

Axis caption: "UMAP of IC-weighted phenotype profiles — proximity suggests,
never asserts." Consistent with the partition's "calibrated judgments, never
facts" footer. No cluster labels claiming nosology.

## Status: pipeline DONE and validated against prod

`backend/pipeline/umap_hero.py` ran against prod on 2026-10-03 (~30s total,
UMAP fit ~5s). Artifact checked in at `frontend/public/emmatics-umap.json`
(518 KB raw, ~160 KB gzipped): 4,721 nodes, 2,882 links, generation
`20261003T224627Z`. Band split of the links: 182 accept / 2,608 review /
92 low — the hero is visually dominated by the amber review band, which is
exactly the triage story. A rendered preview confirmed judged links are
mostly intra-cluster (embedding and judge agree), with a handful of
long-range amber links = natural "surprising connection" callouts.
Re-run the script whenever `/v1/meta` generation changes.

## Build order (for the implementing session)

1. ~~`backend/pipeline/umap_hero.py` + artifact~~ **done, checked in.**
2. ~~`EmmaticsHero.tsx` with static render + fallback.~~ **done.**
3. ~~Interactions (hover/click/zoom), wire into `/physician/page.tsx` replacing
   the header+bands section.~~ **done (2026-10-04):** hero renders on
   `/physician` with an `onFailed` prop; on artifact failure the page falls
   back to the static headline + band cards. The node section below is the
   search-first `/v1/attention` worklist (no full-graph fetch), so the page
   works on the bulk generation.
4. ~~Entrance animation + band-chip link highlighting last (polish).~~
   **done:** chips preview-highlight their band's links on hover.

Verified end-to-end by `scripts/e2e_physician_hero.mjs` (CDP, real pointer
input): canvas pixels, chip counts vs artifact, hover tooltip, click →
triage with judged edges, chip-hover canvas re-render + restore, and the
blocked-artifact fallback. 10/10 checks pass against the bulk generation.
Local demo tip: `EMMA_API_PROXY` in `frontend/next.config.ts` proxies
`/api` + `/v1` same-origin, so point it at a backend serving
`data/graph.bulk.json` to demo prod-scale data without CORS changes.

Note: only ~2,082 nodes have display names (parsed from similarity-edge
descriptions); the rest fall back to the MONDO curie. The tooltip should
lazy-fetch `v1.entity(id)` on hover for a proper name, which also warms the
click-through.
