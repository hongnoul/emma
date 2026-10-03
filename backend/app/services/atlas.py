"""Atlas service: domain queries built on the GraphStore."""
from __future__ import annotations

from ..models.schemas import (
    ConnectionExplanation, DiseaseDetail, Edge, GraphPayload, Node,
    Opportunity, PathStep, RelatedDisease, SearchResult,
)
from .ai_service import get_ai_service
from .graph_store import GraphStore, get_store

SEARCHABLE_TYPES = ("Disease", "Gene", "Phenotype", "Mechanism", "Pathway")


def search(q: str, store: GraphStore | None = None) -> list[SearchResult]:
    store = store or get_store()
    ql = q.lower().strip()
    if not ql:
        return []
    out = []
    for n in store.nodes.values():
        if n.type not in SEARCHABLE_TYPES:
            continue
        hay = f"{n.name} {n.identifier or ''} {n.description}".lower()
        if ql in hay:
            rank = 0 if ql in n.name.lower() else 1
            out.append((rank, SearchResult(id=n.id, type=n.type, name=n.name,
                                           identifier=n.identifier, description=n.description)))
    out.sort(key=lambda t: (t[0], t[1].name))
    return [r for _, r in out[:25]]


def disease_detail(disease_id: str, store: GraphStore | None = None) -> DiseaseDetail | None:
    store = store or get_store()
    d = store.get_node(disease_id)
    if d is None or d.type != "Disease":
        return None
    genes = store.neighbors_out(disease_id, "CAUSED_BY")
    variants = [v for g in genes for v in store.neighbors_out(g.id, "HAS_VARIANT")]
    phenos = store.neighbors_out(disease_id, "HAS_PHENOTYPE")
    mechs = store.neighbors_out(disease_id, "HAS_MECHANISM")
    pathways = [p for g in genes for p in store.neighbors_out(g.id, "AFFECTS_PATHWAY")]
    pubs = store.neighbors_out(disease_id, "SUPPORTED_BY")
    pubs += [p for e in store.edges_touching(disease_id) if e.supporting_publications
             for pid in e.supporting_publications if (p := store.get_node(pid))]
    pubs = list({p.id: p for p in pubs}.values())
    studies = store.neighbors_out(disease_id, "STUDIED_IN")
    researchers = list({r.id: r for p in pubs for r in store.neighbors_out(p.id, "AUTHORED_BY")}.values())
    orgs = store.neighbors_in(disease_id, "RELATED_TO")
    orgs = [o for o in orgs if o.type == "PatientOrganization"]
    asset_owners = [o.id for o in orgs] + [s.id for s in studies] + [r.id for r in researchers]
    assets = list({a.id: a for owner in asset_owners for a in store.neighbors_out(owner, "HAS_ASSET")}.values())
    return DiseaseDetail(disease=d, genes=genes, variants=variants, phenotypes=phenos,
                         mechanisms=mechs, pathways=list({p.id: p for p in pathways}.values()),
                         publications=pubs, studies=studies, researchers=researchers,
                         organizations=orgs, assets=assets)


def related_diseases(disease_id: str, store: GraphStore | None = None) -> list[RelatedDisease]:
    store = store or get_store()
    out = []
    my_phenos = {p.id for p in store.neighbors_out(disease_id, "HAS_PHENOTYPE")}
    my_genes = store.neighbors_out(disease_id, "CAUSED_BY")
    my_pwys = {p.id for g in my_genes for p in store.neighbors_out(g.id, "AFFECTS_PATHWAY")}
    for e in store.edges_touching(disease_id, "SHARES_MECHANISM", "RELATED_TO",
                                  "PHENOTYPE_SIMILAR", "SHARES_GENE_MECHANISM"):
        other_id = e.target if e.source == disease_id else e.source
        other = store.get_node(other_id)
        if other is None or other.type != "Disease":
            continue
        o_phenos = {p.id for p in store.neighbors_out(other_id, "HAS_PHENOTYPE")}
        o_genes = store.neighbors_out(other_id, "CAUSED_BY")
        o_pwys = {p.id for g in o_genes for p in store.neighbors_out(g.id, "AFFECTS_PATHWAY")}
        shared_ph = [store.nodes[i] for i in (my_phenos & o_phenos)]
        shared_pw = [store.nodes[i] for i in (my_pwys & o_pwys)]
        sim = e.edge_valid if e.edge_valid is not None else 0.5
        out.append(RelatedDisease(disease=other, similarity=sim, shared_phenotypes=shared_ph,
                                  shared_pathways=shared_pw, genes=o_genes, connecting_edge=e))
    out.sort(key=lambda r: -r.similarity)
    return out


def disease_graph(disease_id: str, depth: int = 2, store: GraphStore | None = None) -> GraphPayload:
    store = store or get_store()
    nodes, edges = store.subgraph(disease_id, depth=depth)
    return GraphPayload(nodes=nodes, edges=edges)


def full_graph(store: GraphStore | None = None) -> GraphPayload:
    store = store or get_store()
    return GraphPayload(nodes=list(store.nodes.values()), edges=list(store.edges.values()))


def disease_evidence(disease_id: str, store: GraphStore | None = None) -> list[Edge]:
    store = store or get_store()
    return store.edges_touching(disease_id)


def explain_connection(source_id: str, target_id: str, store: GraphStore | None = None) -> ConnectionExplanation | None:
    store = store or get_store()
    s, t = store.get_node(source_id), store.get_node(target_id)
    if s is None or t is None:
        return None
    raw_path = store.shortest_path(source_id, target_id)
    path = [PathStep(node=store.nodes[nid], edge=e) for nid, e in raw_path if nid in store.nodes]
    direct = store.edge_between(source_id, target_id)
    evidence = [st.edge for st in path if st.edge] + ([direct] if direct else [])
    known, inferred, uncertain = [], [], []
    for e in evidence:
        line = f"{store.nodes[e.source].name} —{e.rel_type}→ {store.nodes[e.target].name} ({e.source_db})"
        if e.provenance == "curated" and (e.edge_valid is None or e.edge_valid >= 0.7):
            known.append(line)
        elif e.edge_valid is not None and e.edge_valid < 0.5:
            uncertain.append(line + f" — p(valid)={e.edge_valid}")
        else:
            inferred.append(line + (f" — p(valid)={e.edge_valid}" if e.edge_valid is not None else ""))
        if e.contradictory_evidence:
            uncertain.append(f"Contradictory evidence recorded for {e.id}: {', '.join(e.contradictory_evidence)}")
    narrative = get_ai_service().explain_connection(s, t, path, evidence)
    return ConnectionExplanation(source=s, target=t, path=path, known=known,
                                 inferred=inferred, uncertain=uncertain,
                                 narrative=narrative, evidence_edges=evidence)


def opportunities(disease_id: str, store: GraphStore | None = None) -> list[Opportunity]:
    store = store or get_store()
    d = store.get_node(disease_id)
    if d is None:
        return []
    out: list[Opportunity] = []
    i = 0
    for rel in related_diseases(disease_id, store):
        other = rel.disease
        other_detail = disease_detail(other.id, store)
        if other_detail is None:
            continue
        reusable = ([("study", s) for s in other_detail.studies]
                    + [("asset", a) for a in other_detail.assets]
                    + [("organization", o) for o in other_detail.organizations])
        for kind, item in reusable:
            i += 1
            out.append(Opportunity(
                id=f"OPP-{i:03d}",
                title=f"{item.name} (via {other.name})",
                category=getattr(item, "asset_type", None) or kind,
                what_exists=item.description,
                why_relevant=(f"{d.name} and {other.name} are connected "
                              f"({rel.connecting_edge.rel_type}, p(valid)={rel.connecting_edge.edge_valid}). "
                              f"Shared: {', '.join(p.name for p in rel.shared_pathways + rel.shared_phenotypes[:3]) or 'see edge evidence'}."),
                evidence_edge_ids=[rel.connecting_edge.id],
                needs_validation=["Phenotype comparability between the two diseases",
                                  "Mechanistic overlap confirmed experimentally",
                                  "Eligibility / design transferability",
                                  "Outcome measure relevance"],
                next_step=get_ai_service().suggest_next_step(d, other, item),
            ))
    return out
