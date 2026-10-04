"use client";
// Tiny module-scope bus connecting the apex search bar (ApexHero) to the
// persistent HeroMesh backdrop mounted in the root layout. Props can't flow
// between them (different subtrees), and context would re-render the layout;
// a subscription bus keeps both sides imperative and cheap.

export interface MeshFilter { q: string; ids: string[] | null }

let filter: MeshFilter = { q: "", ids: null };
let matchCount: number | null = null;
let stageEl: HTMLElement | null = null;
let handoffAt = 0;
const handoffSubs = new Set<() => void>();
const unfoldDoneSubs = new Set<() => void>();
let related: { id: string; v: number; name?: string }[] | null = null;
const filterSubs = new Set<(f: MeshFilter) => void>();
const countSubs = new Set<(n: number | null) => void>();
const relatedSubs = new Set<(l: { id: string; v: number; name?: string }[] | null) => void>();

export const meshBus = {
  setFilter(q: string, ids: string[] | null) {
    filter = { q, ids };
    filterSubs.forEach((fn) => fn(filter));
  },
  getFilter: () => filter,
  onFilter(fn: (f: MeshFilter) => void) {
    filterSubs.add(fn);
    return () => { filterSubs.delete(fn); };
  },
  setMatchCount(n: number | null) {
    matchCount = n;
    countSubs.forEach((fn) => fn(n));
  },
  getMatchCount: () => matchCount,
  onMatchCount(fn: (n: number | null) => void) {
    countSubs.add(fn);
    return () => { countSubs.delete(fn); };
  },
  // Stage: a page section that claims the focused node. The mesh reads the
  // element's live rect every frame, so the node tracks layout and scroll.
  setStage(el: HTMLElement | null) { stageEl = el; },
  getStage: () => stageEl,
  // Handoff: MeshBackdrop stamps this when it starts lingering into
  // /physician. EmmaticsHero uses it to delay its opaque panel fade-in so
  // the unfolding sphere stays visible (deep loads skip the delay).
  markHandoff() {
    handoffAt = performance.now();
    handoffSubs.forEach((fn) => fn());
  },
  handoffActive: (windowMs = 1500) =>
    handoffAt > 0 && performance.now() - handoffAt < windowMs,
  // HeroMesh arms its unfold departure here, at navigation *initiation*:
  // waiting for the route commit can lose most of the linger window when
  // the destination page's mount work starves the main thread.
  onHandoff(fn: () => void) {
    handoffSubs.add(fn);
    return () => { handoffSubs.delete(fn); };
  },
  // HeroMesh signals here when the unfold departure reaches 1, so
  // MeshBackdrop can unmount the canvas exactly when the motion is done
  // instead of guessing with a wall-clock timeout (route-mount jank can
  // starve rAF and stretch the unfold well past its nominal duration).
  markUnfoldDone() { unfoldDoneSubs.forEach((fn) => fn()); },
  onUnfoldDone(fn: () => void) {
    unfoldDoneSubs.add(fn);
    return () => { unfoldDoneSubs.delete(fn); };
  },
  // Focus extras: API-sourced related diseases (id + p(valid)) for the
  // focused node. The mesh unions these into the ring so pages whose nodes
  // lack judged links in the static artifact still show their local graph.
  setFocusRelated(list: { id: string; v: number; name?: string }[] | null) {
    related = list;
    relatedSubs.forEach((fn) => fn(related));
  },
  getFocusRelated: () => related,
  onFocusRelated(fn: (l: { id: string; v: number; name?: string }[] | null) => void) {
    relatedSubs.add(fn);
    return () => { relatedSubs.delete(fn); };
  },
};
