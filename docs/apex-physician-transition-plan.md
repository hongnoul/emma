# Apex → Physician transition plan

Goal: the apex landing page flows persona-first (bubble select before search),
and entering the physician workbench feels like one continuous motion instead
of a hard page swap.

## Flow reorder (shipped in phase 1)

Bubble select becomes a state change, not a navigation:

1. `BubbleSelector` gains a select mode: first click pins the bubble (accent
   flood stays on, others dim/shrink), second click on the pinned bubble
   navigates. `onSelect` reports the choice to the parent.
2. `ApexHero` renders the bubbles **above** the search bar and holds a
   `persona` state. Selecting a bubble focuses the search input.
3. The search bar is persona-scoped on submit:
   - explorer / none: `/search?q=` (unchanged)
   - physician: `/physician?q=` — the query seeds the workbench worklist
   - patient: `/patient` (no search there; the bubble chip is the direct path)
4. Mesh live-filtering behaves identically in every persona — that visual
   continuity is the glue across the handoff.

## Phase 1: choreographed handoff (this change)

- `/physician?q=` support: `PhysicianHome` reads `searchParams` and seeds
  `NodeSection`, so the apex query lands pre-filled with results resolving.
- `MeshBackdrop` lingers ~450ms after navigating into `/physician` instead of
  unmounting on the first frame, and the physician canvas background fades in
  over it, so there is no white pop between the two canvases.
- `EmmaticsHero`'s existing entrance (points easing out from center, ~700ms,
  same artifact + band colors as the apex mesh) reads as the second half of
  one motion. The artifact JSON is already in browser cache from the apex
  mesh, so there is no load flash.

## Phase 2: one canvas, sphere unfolds into the map (future)

Both canvases consume the same `/emmatics-umap.json` `{x, y}` coords —
HeroMesh projects them onto a sphere, EmmaticsHero draws them flat.

- Add a `layout: "sphere" | "flat"` state to HeroMesh that lerps each node
  between its sphere projection and its normalized flat UMAP position docked
  to a target rect (the `meshBus.setStage` docking mechanic already exists
  for `/disease/[id]`).
- `/physician` stops mounting its own canvas. `EmmaticsHero` shrinks to a DOM
  shell: stage div (registered via `setStage`), legend, band pills, tooltip
  host. `MeshBackdrop` drops its `/physician` early return; the physician
  hero region goes transparent.
- Result: picking Physician unfolds the sphere into the map of rare disease
  space — zero remount, filter state carried along.

## Risks

- Brief double-canvas overlap in phase 1 (both are visibility-capped rAF).
- The `/` focus hotkey must not fight the pinned-bubble state.
- Deep links straight to `/physician` keep working with zero apex context
  (the hero entrance remains the standalone animation).
