# Rebase plan: Lovable patient + physician prototypes onto emma

Source material (unpacked locally, not committed):

- Patient side: `~/Downloads/seeker-support-bot-site.zip` → `/tmp/emma_zip1`
  ("Rarepath" mobile companion). **Compiled bundle only** — minified
  `routes-qzrcWisi.js` / `index-8VYjPnEP.js` + `styles-BwN7LzHO.css`. No JSX
  source; layouts and copy must be reverse-engineered from the (readable)
  minified output. The minifier kept template-literal classNames and copy
  strings intact, so this is tractable.
- Physician/researcher side: `~/Downloads/273e4877-caee-4313-a4d5-3d11d65c9901.zip`
  → `/tmp/emma_zip2` ("Rare Disease Atlas"). Full TanStack Start source:
  routes `index`, `disease.$mondoId`, `graph.$mondoId`, `research.$mondoId`,
  `researcher.$profileId`, `paper.$pmid`, `sources`; components
  `GraphCanvas`, `EvidenceList`, `DiseaseInsights`, `AiPanels`,
  `AbstractInterpretation`, `StatusStrip`, `SiteHeader` + full shadcn `ui/` kit.

## Non-negotiables (from the ask)

1. **Features and layouts are ported faithfully** — screen structure, flows,
   copy, information hierarchy.
2. **Backend integration respects this repo** — everything goes through
   `frontend/lib/api.ts` against the FastAPI backend. No Supabase, no drizzle,
   no TanStack server functions, no Lovable AI gateway.
3. **Tailwind design respects this repo** — Tailwind v4, repo `globals.css`
   as the single token source. Zip-specific tokens get mapped, not copied
   wholesale.

## Phase 0 — Vendor the references (no behavior change)

- Keep unpacked zips out of git. Add `docs/reference/` notes only if needed.
- Prettify zip1's minified routes file once
  (`npx prettier --parser babel routes-qzrcWisi.js`) and keep the readable
  copy in `/tmp` as the porting reference. All patient screens live in that
  one file (~28 KB): phone frame, tab bar, Journey timeline, Overview
  (dose reminder, adherence, side-effect log), AI chat (canned prompts +
  live `/search` + `/diseases/{id}/evidence` calls), Community (symptom
  cluster, groups, check-in slider flow, consent screen), Research feed.

## Phase 1 — Design-token bridge (SUPERSEDED by repo refactor 6823339)

The repo now standardizes on shadcn/ui with a **monochrome
(black/white/grayscale) neutral theme**: css vars in `globals.css`,
primitives in `components/ui/`, `cn` in `lib/utils.ts`. Rules all ported
code must follow:

- shadcn primitives + semantic tokens only (`bg-background`, `text-muted-foreground`,
  `border`, `bg-primary`, ...). **No chromatic Tailwind classes.**
- Hue encoding is replaced by weight/fill hierarchy
  (solid = established, secondary = review, dashed outline = hidden).
- Token mapping for zip sources:
  - zip1 `ink` → `foreground`, `canvas` → `background`, `brand` → `primary`,
    `warm` → `accent`/`secondary`, `sage` → `muted`,
    `glass`/`glass-soft` → `bg-card/60 backdrop-blur border` via small
    utility classes added to `globals.css` (grayscale only).
  - zip2 shadcn tokens map 1:1, but its oklch hues are discarded in favor
    of the repo's neutral values.
- Fraunces display font from zip1 is allowed (typography, not color), via
  `next/font` scoped to the patient subtree.

## Phase 2 — Patient app (`/patient`)

New route subtree `frontend/app/patient/` reproducing Rarepath inside its
phone frame (aspect 9/16 card, blob background, status bar, bottom tab bar):

| Rarepath tab | Route | Backend mapping |
|---|---|---|
| Journey | `/patient` (default tab) | static timeline content (faithful copy) |
| Overview | `/patient` tab state | adherence/dose/side-effect cards: local state (prototype parity) |
| AI chat | `/patient` tab state | map its `/api/public/v1/search` + `/diseases/{id}/evidence` calls to repo's `api.search()` / `api.evidence()`; the prototype pins `MONDO:0020066` as demo disease — keep but make configurable |
| Community | `/patient` tab state | cluster/groups static; check-in sliders + consent flow local state |
| Research | `/patient` tab state | static researcher-update feed, faithful copy |

Implementation notes:

- Single client component tree mirroring the prototype's structure (it is one
  tab-switching SPA screen, not routed pages). Keep it as
  `app/patient/page.tsx` + `components/patient/*`.
- Where the prototype faked latency/toasts (morning-dose toast after 2.5 s),
  keep the behavior — it is part of the demo layout.
- Backend gap list (decide later, do not block the port): check-in
  persistence, community membership, chat beyond search/evidence. If we want
  them live, add thin FastAPI endpoints; until then the UI runs on local
  state exactly like the prototype.

## Phase 3 — Atlas/physician-research app (zip2 → App Router)

Port each TanStack route to a Next.js page, swapping data access:

| Zip2 route | New route | Data source |
|---|---|---|
| `index` (search) | merge into existing `/` (adopt its richer hero/search layout) | `api.search` |
| `disease.$mondoId` | existing `/disease/[id]` — **merge layouts**, keep repo data plumbing | `api.disease`, `api.evidence`, `api.related`, `api.opportunities` |
| `graph.$mondoId` | existing `/graph/[id]` — adopt its disease-to-disease comparison framing if superior, else keep sigma map | `api.graph` |
| `research.$mondoId` | new `/research/[id]` | needs backend: PubMed proxy endpoint (`/diseases/{id}/papers`) in FastAPI, reusing zip2's connector logic translated to Python, or defer and render from `related`/evidence |
| `researcher.$profileId` | new `/researcher/[id]` | same: thin FastAPI endpoint or defer |
| `paper.$pmid` | new `/paper/[pmid]` | PMC BioC fetch server-side in FastAPI; defer if out of scope |
| `sources` (health) | `/sources` | map to backend `/meta`; drop per-connector health until backend tracks it |

Porting mechanics:

- `createFileRoute`/`useServerFn`/`useQuery` → `"use client"` pages calling
  `lib/api.ts` (repo pattern: plain fetch + loading/error state). Do not add
  react-query unless page complexity forces it.
- Copy zip2's `components/ui/*` (shadcn) **only the ones actually imported**
  by ported pages; they are Tailwind-v4/oklch-token compatible with Phase 1.
- `GraphCanvas` (react-force-graph-2d) conflicts with repo's sigma.js stack:
  keep repo's sigma/graphology for `/graph`, use zip2's layout/chrome around it.
- Strip: `src/integrations/supabase/*`, drizzle, `ai.server.ts`,
  lovable-error-reporting, AGENTS Lovable banner.
- AI panels (paper findings, shared mechanisms): the repo backend already has
  `/judge` + `/edges/{id}/judge`; re-point AI panels at those where the
  concept matches, otherwise hide behind a feature flag until a FastAPI
  equivalent exists.

## Phase 4 — Navigation and reconciliation

- Top-level nav: Atlas (public), Physician partition (existing
  `/physician/*` workbench stays as-is), Patient (`/patient`).
- The existing `/physician` triage/paths workbench is repo-native and is NOT
  replaced by zip2; zip2 is the public atlas layer. Patient app links
  "physician" touchpoints (Dr. Santoso etc.) remain demo copy.
- Delete nothing from the current frontend until its replacement page is
  reviewed side by side.

## Phase 5 — Verification loop

- `npm run build` green at every phase.
- Visual parity pass: run prototype bundle (`npx serve /tmp/emma_zip1`) and
  zip2 (`bun dev`, offline-tolerant) next to the port; compare per screen.
- Grep ported pages for leftover `supabase|serverFn|lovable` — must be zero.
- `gen:api` after any FastAPI endpoint additions so `lib/api.gen.ts` stays
  in sync.

## Order and sizing

1. Phase 1 tokens (~1 commit, small)
2. Phase 2 patient app (1–2 days of careful transcription; biggest faithful-
   layout risk because source is minified — budget review time)
3. Phase 3 atlas pages, starting with disease + search merges (highest value,
   backend already exists), then research/paper/researcher (needs new
   endpoints — separate backend commits)
4. Phase 4 nav + cleanup
