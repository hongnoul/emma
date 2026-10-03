// Atlas prod data -> Lenia seed mappings (prototype).
import { hashStr, seedBlob } from "./lenia";
import { NODE_COLORS } from "./api";

export const PROD = "/prod-api";
export const PROD_UPSTREAM = "https://rare-disease-atlas-api.fly.dev";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PROD}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}: ${path}`);
  return res.json();
}

export interface SeedSpec {
  fx: number; fy: number; // 0..1 grid fractions
  rad: number; amp: number; label: number;
}
export interface SceneData {
  seeds: SeedSpec[];
  palette: string[]; // index = label
  legend: { label: number; text: string }[];
  meta: string[];
}

const TYPE_LABEL: Record<string, number> = {
  Disease: 1, Gene: 2, Phenotype: 3, Mechanism: 4, Pathway: 5,
  Publication: 6, ClinicalTrial: 7, Researcher: 8, PatientOrganization: 9, ResearchAsset: 10,
};
function typePalette(): string[] {
  const p = ["#000000"];
  const order = ["Disease", "Gene", "Phenotype", "Mechanism", "Pathway",
    "Publication", "ClinicalTrial", "Researcher", "PatientOrganization", "ResearchAsset"];
  for (const t of order) p.push((NODE_COLORS as Record<string, string>)[t] ?? "#999999");
  return p;
}

function place(i: number, total: number, salt: number, ringR = 0.32): [number, number] {
  const h = hashStr(`${salt}:${i}`) / 4294967295;
  const ang = (i / Math.max(1, total)) * Math.PI * 2 + h * 0.8;
  const rr = total === 1 ? 0 : ringR * (0.55 + 0.45 * h);
  return [0.5 + Math.cos(ang) * rr, 0.5 + Math.sin(ang) * rr];
}

export function applySeeds(a: Float32Array, lab: Uint8Array, n: number, seeds: SeedSpec[]) {
  a.fill(0); lab.fill(0);
  for (const s of seeds) {
    seedBlob(a, lab, n, s.fx * n, s.fy * n, s.rad, s.amp, s.label);
  }
}

// Scene 1: disease detail -> one organism per facet ring.
export async function sceneDetail(id: string): Promise<SceneData> {
  const d: any = await get(`/api/diseases/${id}`);
  const seeds: SeedSpec[] = [];
  const legend: SceneData["legend"] = [];
  const R = (cells: number) => Math.max(2.5, Math.min(9, 3 + cells * 0.35));
  seeds.push({ fx: 0.5, fy: 0.5, rad: R(6), amp: 1, label: 1 });
  legend.push({ label: 1, text: `Disease ${d.disease.name}` });
  const rings: [any[], number, number][] = [
    [d.genes ?? [], 2, 6], [d.phenotypes ?? [], 3, 3.2], [d.pathways ?? [], 5, 2.6],
    [d.mechanisms ?? [], 4, 2.6], [d.variants ?? [], 2, 2.2],
  ];
  for (const [items, label, rad] of rings) {
    const cap = items.slice(0, 14);
    cap.forEach((it: any, i: number) => {
      const [fx, fy] = place(i, cap.length, label * 100 + items.length);
      seeds.push({ fx, fy, rad, amp: 0.9, label });
    });
    if (cap.length) legend.push({ label, text: `${cap.length} seeded` });
  }
  return {
    seeds, palette: typePalette(), legend,
    meta: [
      `${d.disease.id} ${d.disease.name}`,
      `genes ${d.genes?.length ?? 0} phenos ${d.phenotypes?.length ?? 0} pwys ${d.pathways?.length ?? 0} mechs ${d.mechanisms?.length ?? 0}`,
    ],
  };
}

// Scene 2: neighborhood swarm, one creature per graph node.
export async function sceneSwarm(id: string, depth = 2, cap = 42): Promise<SceneData> {
  const g: any = await get(`/api/diseases/${id}/graph?depth=${depth}`);
  const nodes = g.nodes.slice(0, cap);
  const seeds: SeedSpec[] = nodes.map((nd: any, i: number) => {
    const [fx, fy] = place(i, nodes.length, hashStr(id) % 997, 0.36);
    const big = nd.type === "Disease" ? 5.5 : 3;
    return { fx, fy, rad: big, amp: 0.95, label: TYPE_LABEL[nd.type] ?? 1 };
  });
  return {
    seeds, palette: typePalette(),
    legend: [{ label: 1, text: "Disease" }, { label: 2, text: "Gene" }, { label: 3, text: "Phenotype" }, { label: 5, text: "Pathway" }],
    meta: [`${id} depth=${depth}`, `showing ${nodes.length}/${g.nodes.length} nodes, ${g.edges.length} edges (shared field = shared physics)`],
  };
}

// Scene 3: focal disease vs top related, distance ~ 1 - similarity.
export async function sceneContest(id: string, k = 4): Promise<SceneData> {
  const rel: any[] = await get(`/api/diseases/${id}/related`);
  const top = rel.slice(0, k);
  const seeds: SeedSpec[] = [{ fx: 0.5, fy: 0.5, rad: 7, amp: 1, label: 1 }];
  const legend = [{ label: 1 as number, text: `focal ${id}` }];
  const palette = ["#000000", "#dc2626", "#2563eb", "#d97706", "#7c3aed", "#059669"];
  top.forEach((r: any, i: number) => {
    const sim = r.similarity ?? 0.5;
    const dist = 0.14 + (1 - sim) * 0.3;
    const ang = (i / Math.max(1, top.length)) * Math.PI * 2;
    seeds.push({ fx: 0.5 + Math.cos(ang) * dist, fy: 0.5 + Math.sin(ang) * dist, rad: 5.5, amp: 1, label: i + 2 });
    legend.push({ label: i + 2, text: `${r.disease.id} sim=${typeof sim === "number" ? sim.toFixed(2) : sim} ${r.connecting_edge?.rel_type ?? ""}` });
  });
  return { seeds, palette, legend, meta: [`focal ${id}`, `${top.length} challengers, closer = more similar`] };
}

// Scene 4: evidence edges modulate growth center; seeds tinted by provenance.
export async function sceneEvidence(id: string, cap = 30): Promise<SceneData> {
  const edges: any[] = await get(`/api/diseases/${id}/evidence`);
  const show = edges.slice(0, cap);
  const palette = ["#000000", "#16a34a", "#f59e0b", "#dc2626"];
  const seeds: SeedSpec[] = show.map((e: any, i: number) => {
    const [fx, fy] = place(i, show.length, 7, 0.34);
    const label = e.provenance === "curated" ? 1 : 2;
    const v = typeof e.edge_valid === "number" ? e.edge_valid : 0.5;
    return { fx, fy, rad: 2.5 + v * 3, amp: 0.7 + v * 0.3, label };
  });
  const vals = show.map((e: any) => e.edge_valid).filter((v: any) => typeof v === "number") as number[];
  const mean = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : NaN;
  return {
    seeds, palette,
    legend: [{ label: 1, text: "curated edge" }, { label: 2, text: "inferred edge" }],
    meta: [`${id}: ${edges.length} touching edges (showing ${show.length})`,
      vals.length ? `mean p(valid)=${mean.toFixed(2)} -> mu suggestion ${(0.2 + mean * 0.15).toFixed(2)}` : "no p(valid) on prod edges -> default physics"],
  };
}

// Scene 5: connection path as a wave that pulses along the route.
export async function scenePath(a: string, b: string): Promise<SceneData & { pathIds: string[] }> {
  const c: any = await get(`/api/connections/${a}/${b}`);
  const steps = c.path ?? [];
  const palette = ["#000000", "#dc2626", "#64748b", "#2563eb", "#d97706"];
  const seeds: SeedSpec[] = steps.map((st: any, i: number) => {
    const t = steps.length <= 1 ? 0.5 : 0.15 + (i / (steps.length - 1)) * 0.7;
    return { fx: t, fy: 0.5 + Math.sin(i * 1.3) * 0.08, rad: st.node.type === "Disease" ? 6 : 3.5, amp: 1, label: st.node.type === "Disease" ? 1 : 3 };
  });
  return {
    seeds, palette,
    legend: steps.map((st: any, i: number) => ({ label: 0, text: `${i}. ${st.node.id} (${st.node.type}) ${st.edge?.rel_type ?? "start"}` })),
    meta: [`${a} -> ${b}`, `known ${c.known?.length ?? 0} inferred ${c.inferred?.length ?? 0} uncertain ${c.uncertain?.length ?? 0}`, (c.narrative ?? "").slice(0, 160)],
    pathIds: steps.map((st: any) => st.node.id),
  };
}

// Scene 6: evals reliability bands (prod bulk graph has no judged edges; render honestly).
export async function sceneEvals(): Promise<SceneData> {
  const r: any = await get(`/api/evals?judge=mock`);
  const palette = ["#000000", "#2563eb", "#dc2626"];
  const seeds: SeedSpec[] = [];
  const legend: SceneData["legend"] = [];
  if (!r.bins || r.bins.length === 0) {
    return { seeds, palette, legend, meta: [`evals: n=${r.n}`, (r.notes ?? "no judged edges on prod") + " -> field stays empty (honest empty state)"] };
  }
  return { seeds, palette, legend, meta: [`n=${r.n} acc=${r.accuracy} brier=${r.brier} ece=${r.ece}`] };
}

// Scene 7: opportunities as spores (prod returns [] for sampled diseases; honest empty).
export async function sceneOpps(id: string): Promise<SceneData> {
  const opps: any[] = await get(`/api/diseases/${id}/opportunities`);
  const palette = ["#000000", "#4d7c0f", "#0891b2", "#db2777"];
  const seeds: SeedSpec[] = opps.slice(0, 12).map((o: any, i: number) => {
    const [fx, fy] = place(i, Math.min(opps.length, 12), 21, 0.34);
    return { fx, fy, rad: 3 + Math.min(4, (o.needs_validation?.length ?? 1)), amp: 0.95, label: 1 + (i % 3) };
  });
  return {
    seeds, palette,
    legend: opps.slice(0, 12).map((o: any) => ({ label: 0, text: `${o.id} ${o.title}` })),
    meta: [`${id}: ${opps.length} opportunities`, opps.length ? "spore size ~ validation burden" : "empty on prod -> field stays empty (honest empty state)"],
  };
}
