#!/usr/bin/env python3
"""Generate the demonstration dataset for Rare Disease Atlas.

ALL DATA PRODUCED HERE IS SYNTHETIC DEMONSTRATION DATA.
Identifiers use DEMO-* prefixes on purpose; none of the publications,
studies, people, or organizations are real.

Outputs (written to the repo's data/ directory):
  graph.json           nodes + edges (Laya-ready evidence schema)
  question_packs.json  typed-question definitions shared by mock judge and future Laya
  gold_labels.json     hand-labeled edge validity for the eval harness

Design notes:
  - Curated edges (provenance="curated") carry source_db/source_id and no
    decision fields unless they were re-judged.
  - Inferred edges (provenance="inferred") always carry the full decision
    block: rel_probs, evidence_level, contradicted, edge_valid, state,
    decision_meta. This is the exact shape a Laya judge_edge() call returns,
    so swapping the mock judge for Laya changes no schema.
  - Probabilities are generated to be *roughly* calibrated against the gold
    labels, with two deliberately miscalibrated trap edges so the reliability
    diagram has something to show.
"""
from __future__ import annotations

import json
import random
from datetime import date
from pathlib import Path

random.seed(7)

DATA_DIR = Path(__file__).resolve().parent
TODAY = date(2026, 10, 3).isoformat()
JUDGE = {"model": "mock-judge-v0", "question_pack": "edge-validate-v1", "judged_at": TODAY}

# --------------------------------------------------------------------------
# Nodes
# --------------------------------------------------------------------------

def node(id_, type_, name, description, **extra):
    return {"id": id_, "type": type_, "name": name, "description": description, **extra}

DISEASES = [
    node("DEMO-DIS-001", "Disease", "Demo Lysosomal Storage Disorder A",
         "Demonstration disease. Progressive multisystem disorder caused by deficiency of the demo enzyme LYSA1, leading to substrate accumulation in lysosomes.",
         identifier="DEMO-MONDO:0000001", inheritance="Autosomal recessive"),
    node("DEMO-DIS-002", "Disease", "Demo Neurodegeneration B",
         "Demonstration disease. Childhood-onset neurodegeneration with ataxia and seizures, caused by loss of the demo lysosomal transporter LYSB2.",
         identifier="DEMO-MONDO:0000002", inheritance="Autosomal recessive"),
    node("DEMO-DIS-003", "Disease", "Demo Congenital Myopathy C",
         "Demonstration disease. Early-onset muscle weakness with impaired autophagosome clearance, caused by variants in AUTC3.",
         identifier="DEMO-MONDO:0000003", inheritance="Autosomal dominant"),
    node("DEMO-DIS-004", "Disease", "Demo Retinal Dystrophy D",
         "Demonstration disease. Progressive retinal degeneration caused by variants in the demo ciliary transport gene CILD4.",
         identifier="DEMO-MONDO:0000004", inheritance="Autosomal recessive"),
    node("DEMO-DIS-005", "Disease", "Demo Ciliopathy Syndrome E",
         "Demonstration disease. Multisystem ciliopathy with polydactyly, retinal involvement, and renal cysts; caused by CILE5 or CILE6 variants.",
         identifier="DEMO-MONDO:0000005", inheritance="Autosomal recessive"),
    node("DEMO-DIS-006", "Disease", "Demo Metabolic Disorder F",
         "Demonstration disease. Hepatic glycogen accumulation and fasting intolerance caused by variants in the demo gene GLYF7.",
         identifier="DEMO-MONDO:0000006", inheritance="Autosomal recessive"),
    node("DEMO-DIS-007", "Disease", "Demo Epileptic Encephalopathy G",
         "Demonstration disease. Infantile-onset refractory epilepsy caused by variants in the demo synaptic vesicle gene SYNG8.",
         identifier="DEMO-MONDO:0000007", inheritance="De novo dominant"),
    node("DEMO-DIS-008", "Disease", "Demo Skeletal Dysplasia H",
         "Demonstration disease. Short stature and skeletal anomalies caused by variants in SKEH9 or SKEH10; secondary autophagy involvement reported in one demo study.",
         identifier="DEMO-MONDO:0000008", inheritance="Autosomal dominant"),
]

GENES = [
    node("DEMO-GENE-001", "Gene", "LYSA1", "Demo gene encoding a lysosomal hydrolase.", identifier="DEMO-HGNC:0001"),
    node("DEMO-GENE-002", "Gene", "LYSB2", "Demo gene encoding a lysosomal membrane transporter.", identifier="DEMO-HGNC:0002"),
    node("DEMO-GENE-003", "Gene", "AUTC3", "Demo gene required for autophagosome-lysosome fusion.", identifier="DEMO-HGNC:0003"),
    node("DEMO-GENE-004", "Gene", "CILD4", "Demo gene encoding an intraflagellar transport component.", identifier="DEMO-HGNC:0004"),
    node("DEMO-GENE-005", "Gene", "CILE5", "Demo gene encoding a basal body protein.", identifier="DEMO-HGNC:0005"),
    node("DEMO-GENE-006", "Gene", "CILE6", "Demo gene encoding a ciliary tip kinase.", identifier="DEMO-HGNC:0006"),
    node("DEMO-GENE-007", "Gene", "GLYF7", "Demo gene encoding a glycogen debranching enzyme.", identifier="DEMO-HGNC:0007"),
    node("DEMO-GENE-008", "Gene", "SYNG8", "Demo gene encoding a synaptic vesicle priming factor.", identifier="DEMO-HGNC:0008"),
    node("DEMO-GENE-009", "Gene", "SKEH9", "Demo gene encoding a cartilage matrix protein.", identifier="DEMO-HGNC:0009"),
    node("DEMO-GENE-010", "Gene", "SKEH10", "Demo gene encoding a growth plate signaling receptor.", identifier="DEMO-HGNC:0010"),
]

VARIANTS = [
    node("DEMO-VAR-001", "Variant", "LYSA1 c.100C>T (p.Arg34Ter)", "Demo nonsense variant; classified pathogenic in the demo dataset.", identifier="DEMO-CLINVAR:0001"),
    node("DEMO-VAR-002", "Variant", "LYSB2 c.511G>A (p.Gly171Arg)", "Demo missense variant; classified likely pathogenic in the demo dataset.", identifier="DEMO-CLINVAR:0002"),
]

PHENOTYPES = [
    node("DEMO-HP-0001", "Phenotype", "Seizures", "Demo phenotype.", identifier="DEMO-HP:0001"),
    node("DEMO-HP-0002", "Phenotype", "Hypotonia", "Demo phenotype.", identifier="DEMO-HP:0002"),
    node("DEMO-HP-0003", "Phenotype", "Global developmental delay", "Demo phenotype.", identifier="DEMO-HP:0003"),
    node("DEMO-HP-0004", "Phenotype", "Hepatomegaly", "Demo phenotype.", identifier="DEMO-HP:0004"),
    node("DEMO-HP-0005", "Phenotype", "Retinal degeneration", "Demo phenotype.", identifier="DEMO-HP:0005"),
    node("DEMO-HP-0006", "Phenotype", "Ataxia", "Demo phenotype.", identifier="DEMO-HP:0006"),
    node("DEMO-HP-0007", "Phenotype", "Proximal muscle weakness", "Demo phenotype.", identifier="DEMO-HP:0007"),
    node("DEMO-HP-0008", "Phenotype", "Cardiomyopathy", "Demo phenotype.", identifier="DEMO-HP:0008"),
    node("DEMO-HP-0009", "Phenotype", "Coarse facial features", "Demo phenotype.", identifier="DEMO-HP:0009"),
    node("DEMO-HP-0010", "Phenotype", "Nystagmus", "Demo phenotype.", identifier="DEMO-HP:0010"),
    node("DEMO-HP-0011", "Phenotype", "Postaxial polydactyly", "Demo phenotype.", identifier="DEMO-HP:0011"),
    node("DEMO-HP-0012", "Phenotype", "Short stature", "Demo phenotype.", identifier="DEMO-HP:0012"),
    node("DEMO-HP-0013", "Phenotype", "Spasticity", "Demo phenotype.", identifier="DEMO-HP:0013"),
    node("DEMO-HP-0014", "Phenotype", "Sensorineural hearing loss", "Demo phenotype.", identifier="DEMO-HP:0014"),
    node("DEMO-HP-0015", "Phenotype", "Failure to thrive", "Demo phenotype.", identifier="DEMO-HP:0015"),
]

PATHWAYS = [
    node("DEMO-PWY-001", "Pathway", "Lysosomal degradation pathway", "Demo pathway: substrate trafficking into and catabolism within the lysosome.", identifier="DEMO-PWY:0001"),
    node("DEMO-PWY-002", "Pathway", "Autophagy pathway", "Demo pathway: autophagosome formation, trafficking, and lysosomal fusion.", identifier="DEMO-PWY:0002"),
    node("DEMO-PWY-003", "Pathway", "Ciliary transport pathway", "Demo pathway: intraflagellar transport and basal body assembly.", identifier="DEMO-PWY:0003"),
    node("DEMO-MECH-001", "Mechanism", "Enzyme deficiency (loss of function)", "Demo mechanism: biallelic loss of a catalytic enzyme causing substrate accumulation.", identifier="DEMO-MECH:0001"),
    node("DEMO-MECH-002", "Mechanism", "Impaired organelle clearance", "Demo mechanism: failure to clear damaged organelles or storage material.", identifier="DEMO-MECH:0002"),
]

PUBLICATIONS = [
    node(f"DEMO-PUB-{i:03d}", "Publication", t, "Demonstration publication (not a real paper).", identifier=f"DEMO-PUB-{i:03d}", year=y)
    for i, (t, y) in enumerate([
        ("Biallelic LYSA1 variants cause Demo Lysosomal Storage Disorder A", 2019),
        ("LYSB2 loss impairs lysosomal export in Demo Neurodegeneration B", 2020),
        ("Shared lysosomal pathway dysfunction in demo disorders A and B", 2023),
        ("AUTC3 variants block autophagosome fusion in Demo Myopathy C", 2018),
        ("CILD4 and the demo intraflagellar transport module", 2021),
        ("CILE5/CILE6 and the demo ciliopathy spectrum", 2022),
        ("Natural history of Demo Neurodegeneration B: a 40-patient demo cohort", 2024),
        ("A demo mouse model of LYSA1 deficiency responds to substrate reduction", 2022),
        ("Glycogen debranching and hepatic phenotypes in demo disorder F", 2017),
        ("No evidence of lysosomal involvement in Demo Metabolic Disorder F", 2021),
    ], start=1)
]

STUDIES = [
    node("DEMO-STUDY-001", "ClinicalTrial", "Natural history study of Demo Neurodegeneration B",
         "Demonstration study. Prospective 5-year natural history study; motor and seizure outcome measures.", identifier="DEMO-NCT-0000001", status="Recruiting"),
    node("DEMO-STUDY-002", "ClinicalTrial", "Substrate reduction therapy in Demo Disorder A",
         "Demonstration study. Phase 1/2 open-label trial of demo substrate reduction compound SRT-101.", identifier="DEMO-NCT-0000002", status="Active"),
    node("DEMO-STUDY-003", "ClinicalTrial", "Gene therapy for Demo Retinal Dystrophy D",
         "Demonstration study. Phase 1 subretinal AAV trial.", identifier="DEMO-NCT-0000003", status="Recruiting"),
    node("DEMO-STUDY-004", "ClinicalTrial", "Ketogenic diet in Demo Epileptic Encephalopathy G",
         "Demonstration study. Randomized dietary intervention study.", identifier="DEMO-NCT-0000004", status="Completed"),
]

RESEARCHERS = [
    node("DEMO-RES-001", "Researcher", "Dr. Demo Osei", "Demonstration researcher. Lysosomal biology lab; leads the LYSA1 program.", identifier="DEMO-RES-001", affiliation="Demo University A"),
    node("DEMO-RES-002", "Researcher", "Dr. Demo Ivanova", "Demonstration researcher. Neurodegeneration clinician-scientist; PI of the Disorder B natural history study.", identifier="DEMO-RES-002", affiliation="Demo Children's Hospital"),
    node("DEMO-RES-003", "Researcher", "Dr. Demo Tanaka", "Demonstration researcher. Autophagy and muscle disease.", identifier="DEMO-RES-003", affiliation="Demo Institute C"),
    node("DEMO-RES-004", "Researcher", "Dr. Demo Alvarez", "Demonstration researcher. Ciliopathies and retinal gene therapy.", identifier="DEMO-RES-004", affiliation="Demo Eye Center"),
    node("DEMO-RES-005", "Researcher", "Dr. Demo Okafor", "Demonstration researcher. Metabolic liver disease.", identifier="DEMO-RES-005", affiliation="Demo University B"),
]

ORGS = [
    node("DEMO-ORG-001", "PatientOrganization", "Demo Disorder A Family Alliance", "Demonstration patient organization. Runs the Disorder A patient registry.", identifier="DEMO-ORG-001"),
    node("DEMO-ORG-002", "PatientOrganization", "Demo Neurodegeneration B Foundation", "Demonstration patient organization. Funds the natural history study and a biomarker program.", identifier="DEMO-ORG-002"),
    node("DEMO-ORG-003", "PatientOrganization", "Demo Ciliopathy Network", "Demonstration patient organization. Umbrella group for demo ciliopathy families.", identifier="DEMO-ORG-003"),
    node("DEMO-ORG-004", "PatientOrganization", "Demo Rare Muscle Coalition", "Demonstration patient organization. Supports myopathy research infrastructure.", identifier="DEMO-ORG-004"),
]

ASSETS = [
    node("DEMO-ASSET-001", "ResearchAsset", "Disorder A patient registry", "Demonstration asset. 120-family registry with longitudinal clinical data.", identifier="DEMO-ASSET-001", asset_type="registry"),
    node("DEMO-ASSET-002", "ResearchAsset", "Disorder B natural history dataset", "Demonstration asset. Curated outcome-measure dataset from DEMO-STUDY-001.", identifier="DEMO-ASSET-002", asset_type="natural_history"),
    node("DEMO-ASSET-003", "ResearchAsset", "Lysa1-null demo mouse model", "Demonstration asset. Characterized knockout model with CNS phenotype.", identifier="DEMO-ASSET-003", asset_type="animal_model"),
    node("DEMO-ASSET-004", "ResearchAsset", "Demo lysosomal biomarker panel", "Demonstration asset. CSF biomarker panel validated in Disorder B.", identifier="DEMO-ASSET-004", asset_type="biomarker"),
    node("DEMO-ASSET-005", "ResearchAsset", "CILD4 patient iPSC line", "Demonstration asset. iPSC-derived retinal organoid line.", identifier="DEMO-ASSET-005", asset_type="cell_model"),
]

NODES = DISEASES + GENES + VARIANTS + PHENOTYPES + PATHWAYS + PUBLICATIONS + STUDIES + RESEARCHERS + ORGS + ASSETS

# --------------------------------------------------------------------------
# Edges
# --------------------------------------------------------------------------

_edge_counter = 0
EDGES = []

def _dist_for(p_valid: float) -> dict:
    """Make an internally consistent decision block for a given edge validity."""
    # rel_probs over the edge-classification choice question
    main = 0.35 + 0.6 * p_valid
    rest = 1 - main
    weights = [random.random() for _ in range(3)]
    s = sum(weights)
    alt = [rest * w / s for w in weights]
    rel_probs = {"asserted": round(main, 3), "weaker_association": round(alt[0], 3),
                 "different_relationship": round(alt[1], 3), "unsupported": round(alt[2], 3)}
    # evidence ladder: higher validity -> mass shifted up the ladder
    base = [0.45, 0.3, 0.17, 0.08] if p_valid < 0.5 else [0.06, 0.22, 0.47, 0.25]
    noise = [random.uniform(-0.03, 0.03) for _ in base]
    lv = [max(0.01, b + n) for b, n in zip(base, noise)]
    s = sum(lv)
    lv = [round(v / s, 3) for v in lv]
    expected = round(sum(i * v for i, v in enumerate(lv)), 2)
    return {
        "rel_probs": rel_probs,
        "evidence_level": {"expected": expected,
                           "probs": dict(zip(["hypothesis", "supported", "replicated", "clinical"], lv))},
        "contradicted": round(max(0.01, min(0.97, (1 - p_valid) * random.uniform(0.5, 0.9))), 3),
        "edge_valid": round(p_valid, 3),
    }

def edge(source, target, rel_type, description, *, provenance="curated", source_db=None,
         source_id=None, state=None, pubs=None, contradictory=None, p_valid=None):
    global _edge_counter
    _edge_counter += 1
    e = {
        "id": f"DEMO-EDGE-{_edge_counter:03d}",
        "source": source, "target": target, "rel_type": rel_type,
        "provenance": provenance, "description": description,
        "source_db": source_db or ("atlas-inference" if provenance == "inferred" else "DEMO-DB"),
        "source_id": source_id or f"DEMO-REC-{_edge_counter:03d}",
        "supporting_publications": pubs or [],
        "contradictory_evidence": contradictory or [],
    }
    if p_valid is not None:
        e.update(_dist_for(p_valid))
        e["state"] = state or description
        e["decision_meta"] = dict(JUDGE)
    EDGES.append(e)
    return e

# --- curated biology ---
edge("DEMO-DIS-001", "DEMO-GENE-001", "CAUSED_BY", "Demo Disorder A is caused by biallelic LYSA1 variants.",
     source_db="DEMO-OMIM", pubs=["DEMO-PUB-001"], p_valid=0.95,
     state="[DEMO-PUB-001, 2019] Biallelic loss-of-function variants in LYSA1 were identified in 14 demo patients with Disorder A; enzyme activity was <5% of control in all cases.")
edge("DEMO-DIS-002", "DEMO-GENE-002", "CAUSED_BY", "Demo Neurodegeneration B is caused by biallelic LYSB2 variants.",
     source_db="DEMO-OMIM", pubs=["DEMO-PUB-002"], p_valid=0.93,
     state="[DEMO-PUB-002, 2020] LYSB2 transporter loss abolished lysosomal substrate export in patient fibroblasts from 9 demo families.")
edge("DEMO-DIS-003", "DEMO-GENE-003", "CAUSED_BY", "Demo Myopathy C is caused by dominant AUTC3 variants.", source_db="DEMO-OMIM", pubs=["DEMO-PUB-004"], p_valid=0.91)
edge("DEMO-DIS-004", "DEMO-GENE-004", "CAUSED_BY", "Demo Retinal Dystrophy D is caused by biallelic CILD4 variants.", source_db="DEMO-OMIM", pubs=["DEMO-PUB-005"], p_valid=0.9)
edge("DEMO-DIS-005", "DEMO-GENE-005", "CAUSED_BY", "Demo Ciliopathy E is caused by CILE5 variants.", source_db="DEMO-OMIM", pubs=["DEMO-PUB-006"], p_valid=0.88)
edge("DEMO-DIS-005", "DEMO-GENE-006", "CAUSED_BY", "Demo Ciliopathy E is caused by CILE6 variants in a minority of families.", source_db="DEMO-OMIM", pubs=["DEMO-PUB-006"], p_valid=0.74)
edge("DEMO-DIS-006", "DEMO-GENE-007", "CAUSED_BY", "Demo Metabolic Disorder F is caused by GLYF7 variants.", source_db="DEMO-OMIM", pubs=["DEMO-PUB-009"], p_valid=0.92)
edge("DEMO-DIS-007", "DEMO-GENE-008", "CAUSED_BY", "Demo Epileptic Encephalopathy G is caused by de novo SYNG8 variants.", source_db="DEMO-OMIM", p_valid=0.89)
edge("DEMO-DIS-008", "DEMO-GENE-009", "CAUSED_BY", "Demo Skeletal Dysplasia H is caused by SKEH9 variants.", source_db="DEMO-OMIM", p_valid=0.87)
edge("DEMO-DIS-008", "DEMO-GENE-010", "CAUSED_BY", "Demo Skeletal Dysplasia H is caused by SKEH10 variants (one demo family).", source_db="DEMO-OMIM", p_valid=0.55)
# planted wrong curated edge (trap: curated source, gold label = false)
edge("DEMO-DIS-006", "DEMO-GENE-001", "CAUSED_BY", "Legacy demo record links Disorder F to LYSA1 (superseded; retained to demonstrate contradiction handling).",
     source_db="DEMO-LEGACY-DB", contradictory=["DEMO-PUB-010"], p_valid=0.30,
     state="[DEMO-LEGACY-DB] Single 2009 demo case report linked Disorder F to LYSA1. [DEMO-PUB-010, 2021] found no lysosomal involvement in 25 sequenced demo patients.")

edge("DEMO-GENE-001", "DEMO-VAR-001", "HAS_VARIANT", "Recurrent demo nonsense variant in LYSA1.", source_db="DEMO-CLINVAR")
edge("DEMO-GENE-002", "DEMO-VAR-002", "HAS_VARIANT", "Recurrent demo missense variant in LYSB2.", source_db="DEMO-CLINVAR")

# gene -> pathway
edge("DEMO-GENE-001", "DEMO-PWY-001", "AFFECTS_PATHWAY", "LYSA1 encodes a hydrolase of the demo lysosomal degradation pathway.", pubs=["DEMO-PUB-001"], p_valid=0.94)
edge("DEMO-GENE-002", "DEMO-PWY-001", "AFFECTS_PATHWAY", "LYSB2 exports catabolites from the lysosome in the same demo pathway.", pubs=["DEMO-PUB-002", "DEMO-PUB-003"], p_valid=0.9)
edge("DEMO-GENE-003", "DEMO-PWY-002", "AFFECTS_PATHWAY", "AUTC3 mediates autophagosome-lysosome fusion.", pubs=["DEMO-PUB-004"], p_valid=0.9)
edge("DEMO-GENE-004", "DEMO-PWY-003", "AFFECTS_PATHWAY", "CILD4 is an intraflagellar transport component.", pubs=["DEMO-PUB-005"], p_valid=0.91)
edge("DEMO-GENE-005", "DEMO-PWY-003", "AFFECTS_PATHWAY", "CILE5 localizes to the basal body.", pubs=["DEMO-PUB-006"], p_valid=0.88)
edge("DEMO-GENE-006", "DEMO-PWY-003", "AFFECTS_PATHWAY", "CILE6 phosphorylates ciliary tip substrates.", pubs=["DEMO-PUB-006"], p_valid=0.8)
edge("DEMO-GENE-007", "DEMO-PWY-001", "AFFECTS_PATHWAY", "Legacy demo annotation places GLYF7 in the lysosomal pathway; glycogen debranching is cytosolic.",
     source_db="DEMO-LEGACY-DB", contradictory=["DEMO-PUB-010"], p_valid=0.22,
     state="[DEMO-LEGACY-DB] GLYF7 annotated to lysosomal degradation in a 2012 demo pathway release. [DEMO-PUB-010, 2021] places GLYF7 activity in the cytosol with no lysosomal involvement.")

# mechanisms
edge("DEMO-DIS-001", "DEMO-MECH-001", "HAS_MECHANISM", "Disorder A follows the demo enzyme-deficiency mechanism.", pubs=["DEMO-PUB-001"], p_valid=0.93)
edge("DEMO-DIS-002", "DEMO-MECH-002", "HAS_MECHANISM", "Disorder B shows impaired clearance of storage material.", pubs=["DEMO-PUB-002"], p_valid=0.85)
edge("DEMO-DIS-003", "DEMO-MECH-002", "HAS_MECHANISM", "Myopathy C shows impaired autophagosome clearance.", pubs=["DEMO-PUB-004"], p_valid=0.86)

# disease -> phenotypes (curated, not judged; kept lightweight)
pheno_map = {
    "DEMO-DIS-001": ["DEMO-HP-0002", "DEMO-HP-0003", "DEMO-HP-0004", "DEMO-HP-0009", "DEMO-HP-0015"],
    "DEMO-DIS-002": ["DEMO-HP-0001", "DEMO-HP-0003", "DEMO-HP-0006", "DEMO-HP-0013", "DEMO-HP-0010"],
    "DEMO-DIS-003": ["DEMO-HP-0002", "DEMO-HP-0007", "DEMO-HP-0008"],
    "DEMO-DIS-004": ["DEMO-HP-0005", "DEMO-HP-0010"],
    "DEMO-DIS-005": ["DEMO-HP-0005", "DEMO-HP-0011", "DEMO-HP-0012", "DEMO-HP-0014"],
    "DEMO-DIS-006": ["DEMO-HP-0004", "DEMO-HP-0015", "DEMO-HP-0012"],
    "DEMO-DIS-007": ["DEMO-HP-0001", "DEMO-HP-0003", "DEMO-HP-0013"],
    "DEMO-DIS-008": ["DEMO-HP-0012", "DEMO-HP-0007"],
}
for d, ps in pheno_map.items():
    for p in ps:
        edge(d, p, "HAS_PHENOTYPE", "Demo phenotype association.", source_db="DEMO-HPO")

# research layer
edge("DEMO-DIS-002", "DEMO-STUDY-001", "STUDIED_IN", "Disorder B natural history study.", source_db="DEMO-CTGOV", pubs=["DEMO-PUB-007"])
edge("DEMO-DIS-001", "DEMO-STUDY-002", "STUDIED_IN", "Disorder A substrate reduction trial.", source_db="DEMO-CTGOV")
edge("DEMO-DIS-004", "DEMO-STUDY-003", "STUDIED_IN", "Retinal Dystrophy D gene therapy trial.", source_db="DEMO-CTGOV")
edge("DEMO-DIS-007", "DEMO-STUDY-004", "STUDIED_IN", "Encephalopathy G dietary study.", source_db="DEMO-CTGOV")

for pub, res in [("DEMO-PUB-001", "DEMO-RES-001"), ("DEMO-PUB-002", "DEMO-RES-002"), ("DEMO-PUB-003", "DEMO-RES-001"),
                 ("DEMO-PUB-003", "DEMO-RES-002"), ("DEMO-PUB-004", "DEMO-RES-003"), ("DEMO-PUB-005", "DEMO-RES-004"),
                 ("DEMO-PUB-006", "DEMO-RES-004"), ("DEMO-PUB-007", "DEMO-RES-002"), ("DEMO-PUB-008", "DEMO-RES-001"),
                 ("DEMO-PUB-009", "DEMO-RES-005"), ("DEMO-PUB-010", "DEMO-RES-005")]:
    edge(pub, res, "AUTHORED_BY", "Demo authorship.", source_db="DEMO-PUBMED")

for org, dis in [("DEMO-ORG-001", "DEMO-DIS-001"), ("DEMO-ORG-002", "DEMO-DIS-002"),
                 ("DEMO-ORG-003", "DEMO-DIS-005"), ("DEMO-ORG-004", "DEMO-DIS-003")]:
    edge(org, dis, "RELATED_TO", "Demo patient organization focused on this disease.", source_db="DEMO-ORPHANET")

for owner, asset in [("DEMO-ORG-001", "DEMO-ASSET-001"), ("DEMO-STUDY-001", "DEMO-ASSET-002"),
                     ("DEMO-RES-001", "DEMO-ASSET-003"), ("DEMO-ORG-002", "DEMO-ASSET-004"),
                     ("DEMO-RES-004", "DEMO-ASSET-005")]:
    edge(owner, asset, "HAS_ASSET", "Demo research asset.", source_db="DEMO-DB")

# claims supported by publications
edge("DEMO-DIS-001", "DEMO-PUB-003", "SUPPORTED_BY", "Pathway-sharing claim for Disorder A appears in DEMO-PUB-003.", source_db="DEMO-PUBMED")
edge("DEMO-DIS-002", "DEMO-PUB-003", "SUPPORTED_BY", "Pathway-sharing claim for Disorder B appears in DEMO-PUB-003.", source_db="DEMO-PUBMED")
edge("DEMO-DIS-002", "DEMO-PUB-007", "SUPPORTED_BY", "Natural history cohort for Disorder B.", source_db="DEMO-PUBMED")

# --- atlas-inferred connections (the interesting layer) ---
edge("DEMO-DIS-001", "DEMO-DIS-002", "SHARES_MECHANISM",
     "Disorders A and B both disrupt the demo lysosomal degradation pathway (LYSA1 hydrolase upstream of the LYSB2 export step).",
     provenance="inferred", pubs=["DEMO-PUB-001", "DEMO-PUB-002", "DEMO-PUB-003"], p_valid=0.88,
     state="[DEMO-PUB-003, 2023] Demo fibroblast studies show LYSA1 and LYSB2 act sequentially: hydrolase products accumulate when LYSB2 export is lost, and both patient lines show the same demo storage signature. Phenotype overlap: developmental delay in both; ataxia and seizures specific to B.")
edge("DEMO-DIS-004", "DEMO-DIS-005", "SHARES_MECHANISM",
     "Retinal Dystrophy D and Ciliopathy E both disrupt the demo ciliary transport pathway.",
     provenance="inferred", pubs=["DEMO-PUB-005", "DEMO-PUB-006"], p_valid=0.82,
     state="[DEMO-PUB-005/006] CILD4 (IFT) and CILE5 (basal body) act in the same demo transport module; both diseases share retinal degeneration and nystagmus.")
edge("DEMO-DIS-003", "DEMO-DIS-002", "SHARES_MECHANISM",
     "Myopathy C and Neurodegeneration B may share the impaired-clearance mechanism (autophagy converges on the lysosome).",
     provenance="inferred", pubs=["DEMO-PUB-004", "DEMO-PUB-002"], p_valid=0.62,
     state="[Inference] AUTC3 fusion defects and LYSB2 export defects both produce accumulation of undegraded cargo, but in different tissues (muscle vs CNS) and with partial phenotype overlap (hypotonia only).")
edge("DEMO-DIS-003", "DEMO-DIS-008", "SHARES_MECHANISM",
     "A single demo study reported autophagy involvement in Skeletal Dysplasia H, suggesting overlap with Myopathy C.",
     provenance="inferred", p_valid=0.35,
     state="[Inference] One demo immunostaining study reported LC3 puncta in SKEH9 growth plate sections; no functional demo data; phenotype overlap limited to nonspecific short stature/weakness.")
# trap: plausible-looking but false, judged overconfident on purpose (miscalibration demo)
edge("DEMO-DIS-001", "DEMO-DIS-006", "SHARES_MECHANISM",
     "Disorders A and F both show hepatomegaly and failure to thrive, and a legacy annotation places GLYF7 in the lysosomal pathway.",
     provenance="inferred", contradictory=["DEMO-PUB-010"], p_valid=0.78,
     state="[Inference] Shared phenotypes: hepatomegaly, failure to thrive. Legacy demo annotation links GLYF7 to lysosomal degradation. [DEMO-PUB-010, 2021] contradicts: GLYF7 is cytosolic; storage material in F is glycogen, not lysosomal substrate.")
edge("DEMO-DIS-002", "DEMO-DIS-007", "RELATED_TO",
     "Neurodegeneration B and Encephalopathy G share seizures and developmental delay.",
     provenance="inferred", p_valid=0.3,
     state="[Inference] Overlap is limited to high-prevalence phenotypes (seizures, developmental delay) that carry little information; the genes act in unrelated demo pathways (lysosomal export vs synaptic vesicle priming).")
edge("DEMO-DIS-005", "DEMO-DIS-008", "RELATED_TO",
     "Ciliopathy E and Skeletal Dysplasia H share short stature and polydactyly-adjacent skeletal findings.",
     provenance="inferred", p_valid=0.42,
     state="[Inference] Skeletal overlap exists but demo ciliary genes and growth plate genes act in different modules; one demo review speculates a link via ciliary signaling in chondrocytes.")
edge("DEMO-DIS-001", "DEMO-DIS-003", "RELATED_TO",
     "Disorder A and Myopathy C connect indirectly through lysosome-autophagy convergence.",
     provenance="inferred", p_valid=0.55,
     state="[Inference] Two-hop path: A disrupts lysosomal degradation; C blocks delivery into it. No direct demo co-study exists.")

# second wrong-but-confident trap and one underconfident-true, for the reliability curve
edge("DEMO-DIS-006", "DEMO-DIS-008", "RELATED_TO",
     "Disorders F and H co-occur in one demo case report.",
     provenance="inferred", p_valid=0.72,
     state="[Inference] Single demo case report of co-occurrence; no mechanistic data; shared phenotype limited to short stature.")
edge("DEMO-DIS-002", "DEMO-DIS-004", "RELATED_TO",
     "Disorder B cohort shows retinal thinning on demo OCT, overlapping Retinal Dystrophy D's phenotype domain.",
     provenance="inferred", pubs=["DEMO-PUB-007"], p_valid=0.48,
     state="[DEMO-PUB-007, 2024] 11/40 demo Disorder B patients showed retinal thinning; mechanism unknown; no shared pathway annotated between LYSB2 and CILD4.")

# --------------------------------------------------------------------------
# Question packs (shared by mock judge now, Laya later)
# --------------------------------------------------------------------------

QUESTION_PACKS = {
    "edge-validate-v1": {
        "description": "Validate one graph edge given its evidence snippet (state).",
        "questions": {
            "edge_valid": {"type": "noul",
                           "instructions": "Does the evidence in the state support the asserted relationship between the two entities?"},
            "rel_class": {"type": "choice",
                          "instructions": "Which best describes the relationship given the evidence?",
                          "criteria": {"asserted": "the asserted relationship type is correct",
                                       "weaker_association": "entities are associated but more weakly than asserted",
                                       "different_relationship": "a different relationship type fits better",
                                       "unsupported": "the evidence does not support any relationship"}},
            "evidence_level": {"type": "score",
                               "instructions": "Rate the strength of the supporting evidence.",
                               "criteria": ["hypothesis", "supported", "replicated", "clinical"]},
            "contradicted": {"type": "noul",
                             "instructions": "Does the state contain evidence contradicting the asserted relationship?"},
        },
    },
    "cluster-membership-v1": {
        "description": "Judge whether two diseases plausibly share a mechanism, for cluster validation.",
        "questions": {
            "same_mechanism": {"type": "noul",
                               "instructions": "Do these two diseases disrupt the same biological pathway or mechanism?"},
            "phenotype_informative": {"type": "noul",
                                      "instructions": "Is the phenotype overlap between the two diseases specific/informative rather than generic?"},
        },
    },
}

# --------------------------------------------------------------------------
# Gold labels for the eval harness
# --------------------------------------------------------------------------
# label: 1 = the asserted relationship is real in the demo world, 0 = it is not.
# The demo world's ground truth is defined here, by hand, including the traps.

FALSE_EDGE_PAIRS = {
    ("DEMO-DIS-006", "DEMO-GENE-001"),   # legacy wrong gene link
    ("DEMO-GENE-007", "DEMO-PWY-001"),   # wrong pathway annotation
    ("DEMO-DIS-001", "DEMO-DIS-006"),    # trap: confident but false
    ("DEMO-DIS-002", "DEMO-DIS-007"),    # generic phenotype overlap only
    ("DEMO-DIS-006", "DEMO-DIS-008"),    # trap: single case report, false
    ("DEMO-DIS-003", "DEMO-DIS-008"),    # speculative, false in demo world
    ("DEMO-DIS-005", "DEMO-DIS-008"),    # false in demo world
}

GOLD = []
for e in EDGES:
    if "edge_valid" not in e:
        continue
    label = 0 if (e["source"], e["target"]) in FALSE_EDGE_PAIRS else 1
    GOLD.append({"edge_id": e["id"], "source": e["source"], "target": e["target"],
                 "rel_type": e["rel_type"], "label": label,
                 "note": "demo-world ground truth, hand-assigned"})

# --------------------------------------------------------------------------
# Write
# --------------------------------------------------------------------------

banner = ("THIS IS SYNTHETIC DEMONSTRATION DATA. No publication, study, person, "
          "organization, gene, or disease in this file is real.")

(DATA_DIR / "graph.json").write_text(json.dumps(
    {"_notice": banner, "generated": TODAY, "nodes": NODES, "edges": EDGES}, indent=2))
(DATA_DIR / "question_packs.json").write_text(json.dumps(
    {"_notice": banner, "packs": QUESTION_PACKS}, indent=2))
(DATA_DIR / "gold_labels.json").write_text(json.dumps(
    {"_notice": banner, "labels": GOLD}, indent=2))

print(f"nodes={len(NODES)} edges={len(EDGES)} judged={sum(1 for e in EDGES if 'edge_valid' in e)} gold={len(GOLD)}")
