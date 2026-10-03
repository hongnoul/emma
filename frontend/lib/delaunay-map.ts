// Delaunay similarity map: position from data, adjacency from geometry.
import { Delaunay } from "d3-delaunay";
import { GraphEdge, GraphNode } from "./api";

export const PROD_UPSTREAM = "https://rare-disease-atlas-api.fly.dev";

async function get<T>(path: string): Promise<T> {
  const candidates = ["/prod-api", PROD_UPSTREAM];
  let lastErr: unknown = null;
  for (const base of candidates) {
    try {
      const res = await fetch(`${base}${path}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status}: ${path}`);
      return res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface MapNode {
  id: string; name: string; type: string;
  x: number; y: number; // 0..1 layout
  degree: number; channel: string; // dominant edge channel
  valid: number | null; contradicted: number | null;
}
export interface MapData {
  nodes: MapNode[];
  edges: { a: string; b: string; rel: string; prov: string }[];
  delaunayNote: string;
  meta: string[];
}

const CHANNEL_COLOR: Record<string, string> = {
  SHARES_GENE_MECHANISM: "#2563eb",
  PHENOTYPE_SIMILAR: "#f59e0b",
  SUBTYPE_OF: "#94a3b8",
  CAUSED_BY: "#60a5fa",
  HAS_PHENOTYPE: "#d97706",
};
export { CHANNEL_COLOR };

/** Layout: focal at center, others on rings by graph distance, angle by id hash. */
export async function similarityMap(focal: string, depth = 2, cap = 56): Promise<MapData> {
  const g: { nodes: GraphNode[]; edges: GraphEdge[] } = await get(`/api/diseases/${focal}/graph?depth=${depth}`);
  const diseases = g.nodes.filter((n) => n.type === "Disease");
  const keep = new Set([focal, ...diseases.slice(0, cap - 1).map((n) => n.id)]);
  // BFS distance from focal over disease-disease edges
  const adj = new Map<string, { to: string; rel: string; prov: string }[]>();
  const dedges: { a: string; b: string; rel: string; prov: string }[] = [];
  for (const e of g.edges) {
    if (!keep.has(e.source) || !keep.has(e.target)) continue;
    if (!e.source.startsWith("MONDO") || !e.target.startsWith("MONDO")) continue;
    dedges.push({ a: e.source, b: e.target, rel: e.rel_type, prov: e.provenance });
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push({ to: e.target, rel: e.rel_type, prov: e.provenance });
    adj.get(e.target)!.push({ to: e.source, rel: e.rel_type, prov: e.provenance });
  }
  const dist = new Map<string, number>([[focal, 0]]);
  const q = [focal];
  while (q.length) {
    const cur = q.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (!dist.has(nb.to)) { dist.set(nb.to, dist.get(cur)! + 1); q.push(nb.to); }
    }
  }
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const nodeList = [...keep].filter((id) => byId.has(id));
  // dominant channel + validity per node from incident edges
  const nodes: MapNode[] = nodeList.map((id, i) => {
    const inc = dedges.filter((e) => e.a === id || e.b === id);
    const counts = new Map<string, number>();
    for (const e of inc) counts.set(e.rel, (counts.get(e.rel) ?? 0) + 1);
    const channel = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
    let h = 2166136261;
    for (const c of id) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const hh = (h >>> 0) / 4294967295;
    const d = dist.get(id) ?? 3;
    const ringR = d === 0 ? 0 : 0.16 + Math.min(d, 3) * 0.11;
    const ang = (i / Math.max(1, nodeList.length)) * Math.PI * 2 + hh * 1.2;
    return {
      id, name: byId.get(id)!.name, type: byId.get(id)!.type,
      x: 0.5 + Math.cos(ang) * ringR, y: 0.5 + Math.sin(ang) * ringR,
      degree: inc.length, channel, valid: null, contradicted: null,
    };
  });
  return {
    nodes, edges: dedges,
    delaunayNote: "cell borders = geometric neighbors (similarity reading); dark lines = true graph edges (curated links)",
    meta: [
      `${focal} depth=${depth}: ${nodes.length} disease cells, ${dedges.length} disease-disease edges`,
      `rings = BFS distance from focal; angle = stable id hash; color = dominant channel`,
    ],
  };
}

/** Build Voronoi cells clipped to the canvas box. */
export function voronoiCells(nodes: MapNode[], W: number, H: number) {
  const pts = nodes.map((n) => [n.x * W, n.y * H] as [number, number]);
  const del = Delaunay.from(pts);
  const vor = del.voronoi([0, 0, W, H]);
  return { del, vor };
}
