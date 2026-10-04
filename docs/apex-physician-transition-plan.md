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

## Phase 2a: sphere unfolds into the map (shipped)

Entering /physician from anywhere now plays an unfold departure on the
lingering backdrop canvas:

- HeroMesh arms an unfold when the route flips into /physician: every node
  lerps (~650ms, easeInOut) from its sphere projection to its flat UMAP
  position inside the hero panel rect, using raw min/max normalization to
  match EmmaticsHero's screenXY exactly. Depth fades lift as the map
  flattens. Progress is exposed on `window.__meshUnfold` for the e2e.
- EmmaticsHero registers its panel as the meshBus stage (the unfold target
  rect) and, when `meshBus.handoffActive()` (stamped by ApexHero at nav
  initiation), holds its dark panel transparent (.hero-panel-handoff) so
  the converging mesh stays visible, then fades to dark as its own
  light-on-dark points take over.
- MeshBackdrop's linger grew to 800ms to cover the unfold; it flips the
  linger flag during render (not in an effect) so HeroMesh never unmounts
  for a commit mid-handoff.

## Phase 2b: single canvas (future)

Both canvases consume the same `/emmatics-umap.json` `{x, y}` coords —
HeroMesh projects them onto a sphere, EmmaticsHero draws them flat.

- `/physician` stops mounting its own canvas. `EmmaticsHero` shrinks to a DOM
  shell: stage div (registered via `setStage`), legend, band pills, tooltip
  host. `MeshBackdrop` drops its `/physician` early return; the physician
  hero region goes transparent.
- Gains over 2a: hover/zoom/band state carries across, and the brief
  double-canvas overlap disappears.

## Risks

- Brief double-canvas overlap in phase 1 (both are visibility-capped rAF).
- The `/` focus hotkey must not fight the pinned-bubble state.
- Deep links straight to `/physician` keep working with zero apex context
  (the hero entrance remains the standalone animation).
