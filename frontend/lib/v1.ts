// v1 API client: the six generic primitives plus the physician-partition
// judge endpoints (what-if judging, ablation). Kept separate from lib/api.ts
// (legacy /api/* pages) so the partitions can evolve independently.

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
        ...init,
      });
      if (!res.ok) {
        let detail = `${res.status} ${res.statusText}`;
        try { detail = (await res.json()).detail ?? detail; } catch { /* keep */ }
        throw new ApiError(res.status, detail);
      }
      return res.json();
    } catch (e) {
      if (e instanceof ApiError) throw e; // HTTP errors are not transient
      if (attempt >= 1) throw e instanceof Error ? e : new Error(String(e));
    }
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const get = <T,>(path: string) => req<T>(path);
const post = <T,>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", headers: { "content-type": "application/json" },
                 body: body === undefined ? undefined : JSON.stringify(body) });

// ---- types (mirror backend/app/routers/v1.py) ----

export interface V1Node {
  id: string; type: string; name: string; description: string;
  identifier?: string | null; synonyms?: string[] | null;
}

export interface EvidenceLevel { expected: number; probs: Record<string, number> }
export interface DecisionMeta { model: string; question_pack: string; judged_at: string }

export interface V1Edge {
  id: string; source: string; target: string; rel_type: string;
  provenance: "curated" | "inferred"; description: string;
  source_db: string; source_id: string;
  supporting_publications: string[]; contradictory_evidence: string[];
  rel_probs?: Record<string, number> | null;
  evidence_level?: EvidenceLevel | null;
  contradicted?: number | null;
  edge_valid?: number | null;
  state?: string | null;
  decision_meta?: DecisionMeta | null;
}

export interface EntityHit {
  node: V1Node; match: string; parents: V1Node[];
  subtype_count: number; connections: Record<string, number>;
}
export interface EntitiesResponse { generation_id: string; total: number; items: EntityHit[] }
export interface EdgesResponse { generation_id: string; total: number; limit: number; offset: number; items: V1Edge[] }
export interface EdgeDetail { generation_id: string; edge: V1Edge; source_node?: V1Node | null; target_node?: V1Node | null }
export interface EntityDetail {
  generation_id: string; node: V1Node;
  connections: Record<string, number>; parents: V1Node[]; subtypes: V1Node[];
}

export interface PathStep { node: V1Node; edge?: V1Edge | null }
export interface TrustEdgeGate {
  edge_id: string; p_valid?: number | null; band: string; action: string;
  reason: string; caveat?: string;
}
export interface TrustBlock {
  audience: string; edges: TrustEdgeGate[];
  p_path?: number | null; weakest_link?: number | null;
  weakest_p?: number | null; max_contradicted?: number | null;
}
export interface PathResponse {
  generation_id: string; path: PathStep[];
  known: string[]; inferred: string[]; uncertain: string[];
  narrative: string; evidence_edges: V1Edge[];
  trust?: TrustBlock;
}

export interface TrapResult {
  edge_id: string; pattern: string; p_valid?: number | null;
  passed: boolean; superseded?: number; passed_via?: string;
}
export interface EvalsReport {
  generation_id: string; n: number; accuracy: number; brier: number; ece: number;
  bins: { range: [number, number]; count: number; mean_pred?: number | null; frac_true?: number | null }[];
  notes: string;
  brier_soft?: number; temperature?: number; brier_calibrated?: number;
  trap_pass_rate?: number | null; trap_results?: TrapResult[];
  precision_gate?: { threshold: number; accepted: number; precision?: number; abstention_rate: number; n: number; target: number };
  cost_at_0_5?: { false_positives: number; false_negatives: number; total_cost: number };
  cost_at_0_75?: { false_positives: number; false_negatives: number; total_cost: number };
  contested?: Record<string, { p_valid: number; soft_target: number; verdict?: string }>;
  policy?: {
    established_threshold: number; hide_threshold: number;
    fp_cost: number; fn_cost: number; caveat_language: string; contested_edges: string[];
  };
}

// Raw judge answers (Laya Router.predict contract)
export interface JudgeAnswers {
  edge_valid: { noul: number };
  rel_class: { probabilities: Record<string, number> };
  evidence_level: { score: number; probabilities: Record<string, number> };
  contradicted: { noul: number };
}
export interface JudgeResponse { generation_id: string; pack_id: string; answers: JudgeAnswers }

export interface AblateItem { removed: string; edge_valid: number; delta: number }
export interface AblateResponse {
  generation_id: string; edge_id: string; pack_id: string;
  baseline_valid: number; baseline_contradicted?: number | null; items: AblateItem[];
}

export interface Meta {
  generation_id: string; nodes: number; edges: number;
  node_types: Record<string, number>; rel_types: Record<string, number>;
  judge?: string;
}

// ---- calls ----

export const v1 = {
  meta: () => get<Meta>(`/v1/meta`),
  entities: (q: string, types = "", limit = 20) =>
    get<EntitiesResponse>(`/v1/entities?q=${encodeURIComponent(q)}&types=${types}&limit=${limit}`),
  entity: (curie: string) => get<EntityDetail>(`/v1/entities/${encodeURIComponent(curie)}`),
  edges: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    return get<EdgesResponse>(`/v1/edges?${qs}`);
  },
  edge: (id: string) => get<EdgeDetail>(`/v1/edges/${encodeURIComponent(id)}`),
  paths: (from: string, to: string, audience?: string) =>
    get<PathResponse>(`/v1/paths?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${audience ? `&audience=${audience}` : ""}`),
  evals: (judge = "mock") => get<EvalsReport>(`/v1/evals?judge=${judge}`),
  judge: (state: string, pack_id = "edge-validate-v1") =>
    post<JudgeResponse>(`/v1/judge`, { state, pack_id }),
  ablate: (edgeId: string) => post<AblateResponse>(`/v1/edges/${encodeURIComponent(edgeId)}/ablate`),
};

// ---- shared formatting ----

export const pct = (p?: number | null) => (p == null ? "–" : `${(p * 100).toFixed(0)}%`);
export const pct1 = (p?: number | null) => (p == null ? "–" : `${(p * 100).toFixed(1)}%`);

/** Gate band for a judged probability: expert policy 90/40 (Oct 2026). */
export function band(p?: number | null): { label: string; cls: string } {
  if (p == null) return { label: "curated", cls: "text-slate-500 bg-slate-100" };
  if (p >= 0.9) return { label: "established", cls: "text-green-800 bg-green-100" };
  if (p >= 0.4) return { label: "review", cls: "text-amber-800 bg-amber-100" };
  return { label: "hidden", cls: "text-red-800 bg-red-100" };
}

/** Gate action chip: show / show_with_warning / show_hypothesis / suppress / hidden. */
export function actionCls(action?: string): string {
  if (action === "show") return "text-green-800 bg-green-100";
  if (action === "show_with_warning") return "text-amber-800 bg-amber-100";
  if (action === "show_hypothesis") return "text-blue-800 bg-blue-100";
  if (action === "suppress_pending") return "text-orange-800 bg-orange-100";
  return "text-slate-500 bg-slate-100";
}
