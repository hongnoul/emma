"use client";
// Tiny module-scope bus connecting the apex search bar (ApexHero) to the
// persistent HeroMesh backdrop mounted in the root layout. Props can't flow
// between them (different subtrees), and context would re-render the layout;
// a subscription bus keeps both sides imperative and cheap.

export interface MeshFilter { q: string; ids: string[] | null }

let filter: MeshFilter = { q: "", ids: null };
let matchCount: number | null = null;
const filterSubs = new Set<(f: MeshFilter) => void>();
const countSubs = new Set<(n: number | null) => void>();

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
};
