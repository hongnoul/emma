"""Placeholder connectors for real biomedical data sources.

Each class documents what it will eventually provide and the shape it must
return: nodes and edges matching app.models.schemas. None are implemented;
the prototype runs entirely on data/graph.json.

Integration pattern (same for all):
  1. fetch(ids or query) -> raw records
  2. normalize to Node/Edge dicts (stable identifiers, closed rel_type enum)
  3. for extracted/inferred edges, attach a `state` evidence snippet and
     run DecisionService.judge_edge before inserting into the GraphStore.
"""
from __future__ import annotations


class MondoConnector:
    """MONDO disease ontology. Will provide: canonical disease IDs, names,
    synonyms, cross-references (OMIM/Orphanet) for entity resolution."""


class HPOConnector:
    """Human Phenotype Ontology. Will provide: phenotype terms, disease-
    phenotype annotations (HAS_PHENOTYPE edges), term frequencies for
    distinguishing informative vs generic phenotypes."""


class ClinVarConnector:
    """ClinVar. Will provide: variants, clinical significance, review status
    (maps directly onto the evidence_level ladder), HAS_VARIANT edges."""


class PubMedConnector:
    """PubMed / PMC. Will provide: publications, abstracts (the `state` text
    for edge judging), AUTHORED_BY and SUPPORTED_BY edges."""


class ClinicalTrialsConnector:
    """ClinicalTrials.gov. Will provide: studies, conditions, interventions,
    eligibility criteria; STUDIED_IN edges and reusable study designs."""


class OpenTargetsConnector:
    """Open Targets. Will provide: gene-disease association scores and
    pathway/mechanism evidence to seed SHARES_MECHANISM candidates."""


class MonarchConnector:
    """Monarch Initiative. Will provide: cross-species phenotype matches and
    pre-computed disease-disease similarity to seed RELATED_TO candidates."""


class OrphanetConnector:
    """Orphanet. Will provide: patient organizations, registries, prevalence,
    RELATED_TO (org-disease) and HAS_ASSET edges."""
