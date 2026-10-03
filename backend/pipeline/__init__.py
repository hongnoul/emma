"""Phase 1 ingestion pipeline (see docs/ingestion-pipeline.md).

Stages: fetch -> normalize -> reconcile -> assemble -> judge -> gate -> publish.
Real sources: Monarch Initiative v3 (MONDO/HPO/gene associations, which
aggregates OMIM+Orphanet+HPOA with provenance) and PubMed E-utilities.

Everything raw is cached under data/raw/<source>/ so stages re-run offline.
Output: a graph generation under data/generations/, promoted by the gate to
data/graph.real.json. Serve it with ATLAS_GRAPH_PATH=data/graph.real.json.
"""
