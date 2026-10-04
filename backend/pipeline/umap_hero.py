"""Generate the physician hero UMAP artifact from the PROD API.

Embeds every disease by its IC-weighted phenotype profile with umap-learn
(https://github.com/lmcinnes/umap), attaches the judged PHENOTYPE_SIMILAR
edges, and writes frontend/public/atlas-umap.json keyed by generation_id.

Run:  backend/.venv/bin/python backend/pipeline/umap_hero.py
Deps: umap-learn scipy scikit-learn (pipeline-only, not the API image).
See docs/hero-umap-plan.md for the design.
"""
from __future__ import annotations

import json
import math
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

API = "https://rare-disease-atlas-api.fly.dev"
OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "atlas-umap.json"
PAGE = 500


def get(path: str) -> dict:
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"{API}{path}", timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - transient fly.dev hiccups
            if attempt == 2:
                raise
            print(f"  retry {path}: {e}", file=sys.stderr)
            time.sleep(2)
    raise RuntimeError("unreachable")


def pull_edges(rel: str, judged: bool = False) -> list[dict]:
    qs = f"rel_types={rel}&limit={PAGE}" + ("&judged_only=true" if judged else "")
    first = get(f"/v1/edges?{qs}")
    total, items = first["total"], first["items"]
    while len(items) < total:
        items += get(f"/v1/edges?{qs}&offset={len(items)}")["items"]
        print(f"  {rel}: {len(items)}/{total}", file=sys.stderr)
    return items


def main() -> None:
    meta = get("/v1/meta")
    gen = meta["generation_id"]
    print(f"generation {gen}: {meta['nodes']} nodes, {meta['edges']} edges", file=sys.stderr)

    print("pulling HAS_PHENOTYPE...", file=sys.stderr)
    hp = pull_edges("HAS_PHENOTYPE")
    print("pulling judged PHENOTYPE_SIMILAR...", file=sys.stderr)
    sim = pull_edges("PHENOTYPE_SIMILAR", judged=True)

    # disease -> set(phenotype); IC weight = log(N / df)
    profile: dict[str, set[str]] = defaultdict(set)
    df: dict[str, int] = defaultdict(int)
    for e in hp:
        profile[e["source"]].add(e["target"])
    for phenos in profile.values():
        for p in phenos:
            df[p] += 1
    diseases = sorted(profile)
    n = len(diseases)
    print(f"{n} diseases with phenotype profiles, {len(df)} phenotypes", file=sys.stderr)

    import numpy as np
    from scipy.sparse import csr_matrix

    pheno_idx = {p: i for i, p in enumerate(sorted(df))}
    rows, cols, vals = [], [], []
    for i, d in enumerate(diseases):
        for p in profile[d]:
            rows.append(i)
            cols.append(pheno_idx[p])
            vals.append(math.log(n / df[p]))
    X = csr_matrix((vals, (rows, cols)), shape=(n, len(pheno_idx)), dtype="float32")

    import umap

    print("fitting UMAP (cosine, n_neighbors=15)...", file=sys.stderr)
    emb = umap.UMAP(metric="cosine", n_neighbors=15, min_dist=0.1,
                    random_state=42, verbose=True).fit_transform(X)
    emb = np.asarray(emb, dtype="float32")

    # names for diseases come along on the similarity edges' descriptions only;
    # fetch names in bulk from the HAS_PHENOTYPE pull is not possible (edges
    # carry ids). Use /v1/entities/{curie}? Too many calls. Instead the edge
    # descriptions already embed names; fall back to curie when unknown.
    name: dict[str, str] = {}
    for e in sim:
        desc = e.get("description", "")
        if " and " in desc and " share " in desc:
            left, rest = desc.split(" and ", 1)
            right = rest.split(" share ", 1)[0]
            name.setdefault(e["source"], left.strip())
            name.setdefault(e["target"], right.strip())

    didx = {d: i for i, d in enumerate(diseases)}
    deg: dict[str, int] = defaultdict(int)
    links = []
    for e in sim:
        s, t = didx.get(e["source"]), didx.get(e["target"])
        if s is None or t is None:
            continue
        deg[e["source"]] += 1
        deg[e["target"]] += 1
        links.append({"id": e["id"], "s": s, "t": t,
                      "v": round(e.get("edge_valid") or 0, 4)})

    nodes = [{"id": d,
              "n": name.get(d, d),
              "x": round(float(emb[i, 0]), 3),
              "y": round(float(emb[i, 1]), 3),
              "deg": deg.get(d, 0)}
             for i, d in enumerate(diseases)]

    OUT.write_text(json.dumps({"generation_id": gen, "nodes": nodes,
                               "links": links}, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB): "
          f"{len(nodes)} nodes, {len(links)} links", file=sys.stderr)


if __name__ == "__main__":
    main()
