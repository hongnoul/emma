"""Graph store: the single data-access layer.

Currently backed by data/graph.json. To move to Neo4j (or any graph DB),
reimplement this class against the same method signatures; nothing above
this layer touches the JSON directly.
"""
from __future__ import annotations

import json
from collections import defaultdict
from functools import lru_cache
from pathlib import Path

from ..models.schemas import Edge, Node

import os as _os
DATA_DIR = Path(_os.environ.get("EMMATICS_DATA_DIR", _os.environ.get("ATLAS_DATA_DIR") or Path(__file__).resolve().parents[3] / "data"))


class GraphStore:
    def __init__(self, graph_path: Path | None = None):
        raw = json.loads((graph_path or DATA_DIR / "graph.json").read_text())
        self.generation: str = raw.get("generation", "demo")
        self.nodes: dict[str, Node] = {n["id"]: Node(**n) for n in raw["nodes"]}
        self.edges: dict[str, Edge] = {e["id"]: Edge(**e) for e in raw["edges"]}
        self._out: dict[str, list[Edge]] = defaultdict(list)
        self._in: dict[str, list[Edge]] = defaultdict(list)
        for e in self.edges.values():
            self._out[e.source].append(e)
            self._in[e.target].append(e)

    # ---- nodes ----
    def get_node(self, node_id: str) -> Node | None:
        return self.nodes.get(node_id)

    def nodes_by_type(self, *types: str) -> list[Node]:
        return [n for n in self.nodes.values() if n.type in types]

    # ---- edges ----
    def edges_out(self, node_id: str, *rel_types: str) -> list[Edge]:
        es = self._out.get(node_id, [])
        return [e for e in es if not rel_types or e.rel_type in rel_types]

    def edges_in(self, node_id: str, *rel_types: str) -> list[Edge]:
        es = self._in.get(node_id, [])
        return [e for e in es if not rel_types or e.rel_type in rel_types]

    def edges_touching(self, node_id: str, *rel_types: str) -> list[Edge]:
        return self.edges_out(node_id, *rel_types) + self.edges_in(node_id, *rel_types)

    def neighbors_out(self, node_id: str, *rel_types: str) -> list[Node]:
        return [self.nodes[e.target] for e in self.edges_out(node_id, *rel_types) if e.target in self.nodes]

    def neighbors_in(self, node_id: str, *rel_types: str) -> list[Node]:
        return [self.nodes[e.source] for e in self.edges_in(node_id, *rel_types) if e.source in self.nodes]

    def edge_between(self, a: str, b: str) -> Edge | None:
        for e in self._out.get(a, []):
            if e.target == b:
                return e
        for e in self._out.get(b, []):
            if e.target == a:
                return e
        return None

    # ---- generic query (v1 API) ----
    def query_edges(self, from_id: str | None = None, to_id: str | None = None,
                    node_id: str | None = None, rel_types: list[str] | None = None,
                    provenance: str | None = None, min_valid: float | None = None,
                    max_valid: float | None = None,
                    judged_only: bool = False,
                    limit: int = 50, offset: int = 0) -> tuple[list[Edge], int]:
        """Filterable edge query. node_id matches either endpoint. Returns (page, total)."""
        if from_id:
            base = self._out.get(from_id, [])
        elif to_id:
            base = self._in.get(to_id, [])
        elif node_id:
            base = self._out.get(node_id, []) + self._in.get(node_id, [])
        else:
            base = list(self.edges.values())
        out = []
        for e in base:
            if to_id and e.target != to_id and not from_id and not node_id:
                pass  # base already filtered by _in
            if rel_types and e.rel_type not in rel_types:
                continue
            if provenance and e.provenance != provenance:
                continue
            if judged_only and e.edge_valid is None:
                continue
            if min_valid is not None and (e.edge_valid is None or e.edge_valid < min_valid):
                continue
            if max_valid is not None and (e.edge_valid is None or e.edge_valid > max_valid):
                continue
            out.append(e)
        # deterministic order: judged desc by p(valid), then id
        out.sort(key=lambda e: (-(e.edge_valid if e.edge_valid is not None else -1), e.id))
        return out[offset:offset + limit], len(out)

    def adjacency_summary(self, node_id: str) -> dict:
        """Counts per rel_type (out+in) for a node."""
        from collections import Counter
        c = Counter()
        for e in self._out.get(node_id, []):
            c[e.rel_type] += 1
        for e in self._in.get(node_id, []):
            c[e.rel_type] += 1
        return dict(c)

    # ---- traversal ----
    def subgraph(self, center_id: str, depth: int = 2, max_nodes: int = 80) -> tuple[list[Node], list[Edge]]:
        """BFS neighborhood around a node, undirected."""
        seen = {center_id}
        frontier = [center_id]
        for _ in range(depth):
            nxt = []
            for nid in frontier:
                for e in self.edges_touching(nid):
                    other = e.target if e.source == nid else e.source
                    if other not in seen and len(seen) < max_nodes:
                        seen.add(other)
                        nxt.append(other)
            frontier = nxt
        nodes = [self.nodes[i] for i in seen if i in self.nodes]
        edges = [e for e in self.edges.values() if e.source in seen and e.target in seen]
        return nodes, edges

    def shortest_path(self, start: str, goal: str, max_depth: int = 6) -> list[tuple[str, Edge | None]]:
        """Shortest path, preferring mechanistic routes.

        Tries first through Gene/Pathway/Mechanism/Variant intermediates only
        (the biologically explanatory route), then falls back to any route.
        Excludes direct start--goal edges so explanations show the chain
        rather than the inferred shortcut itself.
        """
        mech = {"Gene", "Pathway", "Mechanism", "Variant"}
        path = self._bfs(start, goal, max_depth,
                         allowed=lambda nid: nid in (start, goal) or
                         (self.nodes.get(nid) is not None and self.nodes[nid].type in mech))
        return path or self._bfs(start, goal, max_depth, allowed=lambda nid: True)

    def _bfs(self, start: str, goal: str, max_depth: int,
             allowed) -> list[tuple[str, Edge | None]]:
        if start == goal:
            return [(start, None)]
        prev: dict[str, tuple[str, Edge]] = {}
        seen = {start}
        frontier = [start]
        for _ in range(max_depth):
            nxt = []
            for nid in frontier:
                for e in self.edges_touching(nid):
                    if {e.source, e.target} == {start, goal}:
                        continue  # skip the shortcut edge
                    other = e.target if e.source == nid else e.source
                    if other in seen or not allowed(other):
                        continue
                    seen.add(other)
                    prev[other] = (nid, e)
                    if other == goal:
                        path: list[tuple[str, Edge | None]] = [(goal, e)]
                        cur = nid
                        while cur != start:
                            p, pe = prev[cur]
                            path.append((cur, pe))
                            cur = p
                        path.append((start, None))
                        return list(reversed(path))
                    nxt.append(other)
            frontier = nxt
        return []


@lru_cache(maxsize=1)
def get_store() -> GraphStore:
    """Default: data/graph.json (demo). Override with EMMATICS_GRAPH_PATH to
    serve a pipeline-built generation, e.g. data/graph.real.json."""
    import os
    override = os.environ.get("EMMATICS_GRAPH_PATH", os.environ.get("ATLAS_GRAPH_PATH"))
    if override:
        p = Path(override)
        if not p.is_absolute():
            p = DATA_DIR.parent / override
        return GraphStore(p)
    return GraphStore()
