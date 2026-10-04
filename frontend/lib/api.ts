// Single API client for the Emmatics backend.
// All pages go through these functions; swap API_BASE for deployment.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  // 15s timeout so a cold-starting backend shows an error instead of an
  // infinite "Loading…"; one retry covers the warm-up case.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`);
      return res.json();
    } catch (e) {
      if (attempt >= 1) throw e instanceof Error ? e : new Error(String(e));
    }
  }
}

// ---- types mirroring backend/app/models/schemas.py ----

export type NodeType =
  | "Disease" | "Gene" | "Variant" | "Phenotype" | "Mechanism" | "Pathway"
  | "Publication" | "ClinicalTrial" | "Researcher" | "PatientOrganization" | "ResearchAsset";

export interface GraphNode {
  id: string; type: NodeType; name: string; description: string;
  identifier?: string | null; inheritance?: string | null; year?: number | null;
  status?: string | null; affiliation?: string | null; asset_type?: string | null;
}

export interface EvidenceLevel { expected: number; probs: Record<string, number> }
export interface DecisionMeta { model: string; question_pack: string; judged_at: string }

export interface GraphEdge {
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

export interface SearchResult {
  id: string; type: NodeType; name: string; identifier?: string | null; description: string;
}

export interface RelatedDisease {
  disease: GraphNode; similarity: number;
  shared_phenotypes: GraphNode[]; shared_pathways: GraphNode[];
  genes: GraphNode[]; connecting_edge: GraphEdge;
}

export interface DiseaseDetail {
  disease: GraphNode; genes: GraphNode[]; variants: GraphNode[];
  phenotypes: GraphNode[]; mechanisms: GraphNode[]; pathways: GraphNode[];
  publications: GraphNode[]; studies: GraphNode[]; researchers: GraphNode[];
  organizations: GraphNode[]; assets: GraphNode[];
}

export interface GraphPayload { nodes: GraphNode[]; edges: GraphEdge[] }
export interface PathStep { node: GraphNode; edge?: GraphEdge | null }

export interface ConnectionExplanation {
  source: GraphNode; target: GraphNode; path: PathStep[];
  known: string[]; inferred: string[]; uncertain: string[];
  narrative: string; evidence_edges: GraphEdge[];
}

export interface Opportunity {
  id: string; title: string; category: string;
  what_exists: string; why_relevant: string;
  evidence_edge_ids: string[]; needs_validation: string[];
  next_step: string; disclaimer: string;
}

export interface EvalReport {
  n: number; accuracy: number; brier: number; ece: number;
  bins: { range: number[]; count: number; mean_pred: number | null; frac_true: number | null }[];
  notes: string;
}

// ---- basic research (live PubMed/PMC via backend proxy) ----

export interface ResearchPaper {
  pmid: string; title: string; journal: string; date: string;
  authors: string[]; pmcid: string | null; doi: string | null;
  models: string[];
  classification: { label: string; kind: string; source: string; snippet: string }[];
}

export interface BasicResearch {
  disease: { id: string; label: string };
  total: number; papers: ResearchPaper[]; counts: Record<string, number>;
  classificationError: string | null; error: string | null;
}

export interface PaperFullText {
  id: string; title: string; license: string | null;
  sections: { type: string; heading: string | null; paragraphs: string[] }[];
}

export interface PaperDetail {
  paper: Omit<ResearchPaper, "models" | "classification"> | null;
  fullText: PaperFullText | null;
  error: string | null;
}

// ---- calls ----

export const api = {
  search: (q: string) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  disease: (id: string) => get<DiseaseDetail>(`/api/diseases/${id}`),
  related: (id: string) => get<RelatedDisease[]>(`/api/diseases/${id}/related`),
  diseaseGraph: (id: string, depth = 2) => get<GraphPayload>(`/api/diseases/${id}/graph?depth=${depth}`),
  evidence: (id: string) => get<GraphEdge[]>(`/api/diseases/${id}/evidence`),
  opportunities: (id: string) => get<Opportunity[]>(`/api/diseases/${id}/opportunities`),
  connection: (a: string, b: string) => get<ConnectionExplanation>(`/api/connections/${a}/${b}`),
  edge: (id: string) => get<GraphEdge>(`/api/edges/${id}`),
  evals: (judge: "mock" | "laya" = "mock") => get<EvalReport>(`/api/evals?judge=${judge}`),
  research: (id: string) => get<BasicResearch>(`/api/diseases/${id}/research`),
  paper: (pmid: string) => get<PaperDetail>(`/api/papers/${pmid}`),
};

// Shared tiny helpers (kept here to avoid a components/ tree)

export const NODE_COLORS: Record<NodeType, string> = {
  Disease: "#dc2626", Gene: "#2563eb", Variant: "#60a5fa", Phenotype: "#d97706",
  Mechanism: "#7c3aed", Pathway: "#9333ea", Publication: "#64748b",
  ClinicalTrial: "#059669", Researcher: "#0891b2", PatientOrganization: "#db2777",
  ResearchAsset: "#4d7c0f",
};

export function pct(p?: number | null): string {
  return p == null ? "n/a" : `${Math.round(p * 100)}%`;
}

// Disease-centric graph view: edge channel colors + node types hidden by default.
export const EDGE_CHANNEL_COLORS: Record<string, string> = {
  PHENOTYPE_SIMILAR: "#f59e0b",      // amber: inferred, Laya-judged
  SHARES_MECHANISM: "#f59e0b",
  SHARES_GENE_MECHANISM: "#2563eb",  // blue: curated gene channel
  RELATED_TO: "#fbbf24",
};
export const DEFAULT_HIDDEN_TYPES: NodeType[] = ["Phenotype", "Publication"];
