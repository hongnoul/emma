"""Pydantic models for Rare Disease Atlas.

The evidence schema is Laya-ready: edges carry probability distributions
(rel_probs, evidence_level, contradicted, edge_valid) instead of a single
confidence float, plus the state snippet and decision_meta needed to
re-judge any edge independently.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

NodeType = Literal[
    "Disease", "Gene", "Variant", "Phenotype", "Mechanism", "Pathway",
    "Publication", "ClinicalTrial", "Researcher", "PatientOrganization", "ResearchAsset",
]

RelType = Literal[
    "CAUSED_BY", "HAS_VARIANT", "HAS_PHENOTYPE", "AFFECTS_PATHWAY", "HAS_MECHANISM",
    "STUDIED_IN", "SUPPORTED_BY", "AUTHORED_BY", "HAS_ASSET", "SHARES_MECHANISM", "RELATED_TO",
    # disease-centric channels (bulk pipeline): two parallel evidence channels
    "PHENOTYPE_SIMILAR",      # shared phenotype profile, judged by Laya
    "SHARES_GENE_MECHANISM",  # same causal gene(s) / gene family
]


class Node(BaseModel):
    id: str
    type: NodeType
    name: str
    description: str = ""
    identifier: Optional[str] = None
    # optional per-type extras
    inheritance: Optional[str] = None
    year: Optional[int] = None
    status: Optional[str] = None
    affiliation: Optional[str] = None
    asset_type: Optional[str] = None


class EvidenceLevel(BaseModel):
    """Distribution over an ordered evidence ladder (Laya `score` output)."""
    expected: float = Field(description="Expected level index, e.g. 2.3 = between replicated and clinical")
    probs: dict[str, float]


class DecisionMeta(BaseModel):
    model: str
    question_pack: str
    judged_at: str


class Edge(BaseModel):
    id: str
    source: str
    target: str
    rel_type: RelType
    provenance: Literal["curated", "inferred"]
    description: str = ""
    source_db: str
    source_id: str
    supporting_publications: list[str] = []
    contradictory_evidence: list[str] = []
    # ---- decision block (present when the edge has been judged) ----
    rel_probs: Optional[dict[str, float]] = None       # Laya `choice` output
    evidence_level: Optional[EvidenceLevel] = None     # Laya `score` output
    contradicted: Optional[float] = None               # Laya `noul`: p(contradiction)
    edge_valid: Optional[float] = None                 # Laya `noul`: p(edge holds)
    state: Optional[str] = None                        # embedded evidence snippet
    decision_meta: Optional[DecisionMeta] = None


class SearchResult(BaseModel):
    id: str
    type: NodeType
    name: str
    identifier: Optional[str] = None
    description: str = ""


class RelatedDisease(BaseModel):
    disease: Node
    similarity: float
    shared_phenotypes: list[Node]
    shared_pathways: list[Node]
    genes: list[Node]
    connecting_edge: Edge


class DiseaseDetail(BaseModel):
    disease: Node
    genes: list[Node]
    variants: list[Node]
    phenotypes: list[Node]
    mechanisms: list[Node]
    pathways: list[Node]
    publications: list[Node]
    studies: list[Node]
    researchers: list[Node]
    organizations: list[Node]
    assets: list[Node]


class GraphPayload(BaseModel):
    nodes: list[Node]
    edges: list[Edge]


class PathStep(BaseModel):
    node: Node
    edge: Optional[Edge] = None  # edge leading into this node (None for the first)


class ConnectionExplanation(BaseModel):
    source: Node
    target: Node
    path: list[PathStep]
    known: list[str]
    inferred: list[str]
    uncertain: list[str]
    narrative: str
    evidence_edges: list[Edge]


class Opportunity(BaseModel):
    id: str
    title: str
    category: str
    what_exists: str
    why_relevant: str
    evidence_edge_ids: list[str]
    needs_validation: list[str]
    next_step: str
    disclaimer: str = (
        "Research opportunity requiring expert validation. Not a medical recommendation."
    )


class EvalReport(BaseModel):
    n: int
    accuracy: float
    brier: float
    ece: float
    bins: list[dict]
    notes: str
