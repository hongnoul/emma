"use client";
// Interactive knowledge graph: graphology + sigma (the Gephi ecosystem's
// web stack, as used by Gephi Lite). ForceAtlas2 layout, same as Gephi.
// Export to Gephi desktop: GET /api/graph.gexf (link below the canvas).
import { use, useEffect, useRef, useState } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { circular } from "graphology-layout";
import type Sigma from "sigma";
import { api, DEFAULT_HIDDEN_TYPES, EDGE_CHANNEL_COLORS, GraphEdge, GraphNode, NODE_COLORS, NodeType, pct } from "@/lib/api";

const ALL_TYPES = Object.keys(NODE_COLORS) as NodeType[];
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export default function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const container = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set(DEFAULT_HIDDEN_TYPES));
  const [sel, setSel] = useState<{ kind: "node"; node: GraphNode } | { kind: "edge"; edge: GraphEdge } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.diseaseGraph(id, 2).then(setData).catch((e) => setError(String(e))); }, [id]);

  useEffect(() => {
    if (!data || !container.current) return;
    const el = container.current;
    let sigma: Sigma | null = null;
    let cancelled = false;

    // sigma requires WebGL, so it must be imported client-side only.
    import("sigma").then(({ default: SigmaCtor }) => {
      if (cancelled || !el) return;
      const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
      const edgeById = new Map(data.edges.map((e) => [e.id, e]));

      const graph = new Graph({ multi: true });
      for (const n of data.nodes) {
        graph.addNode(n.id, {
          label: n.name,
          size: n.type === "Disease" ? 14 : 7,
          color: NODE_COLORS[n.type] ?? "#999",
          nodeType: n.type,
        });
      }
      for (const e of data.edges) {
        if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
        graph.addEdgeWithKey(e.id, e.source, e.target, {
          label: e.edge_valid != null ? `${e.rel_type} ${Math.round(e.edge_valid * 100)}%` : e.rel_type,
          size: EDGE_CHANNEL_COLORS[e.rel_type] ? 2.5 : 1.5,
          color: EDGE_CHANNEL_COLORS[e.rel_type] ?? "#cbd5e1",
        });
      }

      // Gephi-style layout: circular seed, then ForceAtlas2.
      circular.assign(graph);
      forceAtlas2.assign(graph, {
        iterations: 300,
        settings: { ...forceAtlas2.inferSettings(graph), gravity: 1, scalingRatio: 6 },
      });

      sigma = new SigmaCtor(graph, el, {
        renderEdgeLabels: true,
        edgeLabelSize: 10,
        labelSize: 11,
        labelRenderedSizeThreshold: 8,
        enableEdgeEvents: true,
      });
      sigma.on("clickNode", ({ node }) => { const n = nodeById.get(node); if (n) setSel({ kind: "node", node: n }); });
      sigma.on("clickEdge", ({ edge }) => { const e = edgeById.get(edge); if (e) setSel({ kind: "edge", edge: e }); });
      sigma.on("clickStage", () => setSel(null));

      sigmaRef.current = sigma;
      graphRef.current = graph;
      // Exposed for debugging and end-to-end tests (see scripts/e2e_graph_click.mjs).
      (window as unknown as Record<string, unknown>).__atlasSigma = sigma;
    });

    return () => { cancelled = true; sigma?.kill(); sigmaRef.current = null; graphRef.current = null; };
  }, [data]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.forEachNode((node, attrs) => {
      graph.setNodeAttribute(node, "hidden", hidden.has(attrs.nodeType as NodeType));
    });
  }, [hidden, data]);

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!data) return <p className="text-muted-foreground">Loading graph…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 items-center text-xs">
        {ALL_TYPES.map((t) => (
          <button key={t}
            onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(t)) n.delete(t); else n.add(t); return n; })}
            className={`rounded px-2 py-1 border ${hidden.has(t) ? "opacity-30" : ""}`}
            style={{ borderColor: NODE_COLORS[t], color: NODE_COLORS[t] }}>
            {t}
          </button>
        ))}
        <button onClick={() => sigmaRef.current?.getCamera().animatedReset()} className="rounded px-2 py-1 border ml-2 hover:bg-muted">Center</button>
        <button onClick={() => {
          setHidden(new Set(DEFAULT_HIDDEN_TYPES));
          const g = graphRef.current;
          if (g) { circular.assign(g); forceAtlas2.assign(g, { iterations: 300, settings: { ...forceAtlas2.inferSettings(g), gravity: 1, scalingRatio: 6 } }); }
          sigmaRef.current?.getCamera().animatedReset();
        }} className="rounded px-2 py-1 border hover:bg-muted">Reset</button>
        <span className="text-muted-foreground ml-auto">amber = phenotype-similar (judged) · blue = shared gene</span>
      </div>

      <div className="flex gap-4">
        <div ref={container} className="flex-1 h-[560px] border rounded-lg" />
        <aside className="w-80 shrink-0 border rounded-lg p-4 text-sm space-y-2 overflow-y-auto max-h-[560px]">
          {!sel && <p className="text-muted-foreground">Click a node or edge for details.</p>}
          {sel?.kind === "node" && (
            <>
              <h3 className="font-semibold">{sel.node.name}</h3>
              <p><span className="text-xs rounded px-1.5 py-0.5 text-white" style={{ background: NODE_COLORS[sel.node.type] }}>{sel.node.type}</span></p>
              <p className="text-xs text-muted-foreground">{sel.node.identifier}</p>
              <p>{sel.node.description}</p>
              <p className="text-xs text-muted-foreground">Source: synthetic demo dataset</p>
            </>
          )}
          {sel?.kind === "edge" && (
            <>
              <h3 className="font-semibold">{sel.edge.rel_type}</h3>
              <p>{sel.edge.description}</p>
              <p className="text-xs">
                <span className={`rounded px-1.5 py-0.5 ${sel.edge.provenance === "inferred" ? "border border-dashed text-muted-foreground" : "bg-secondary text-secondary-foreground border"}`}>
                  {sel.edge.provenance === "inferred" ? "ATLAS-INFERRED CONNECTION" : "DIRECT / CURATED EVIDENCE"}
                </span>
              </p>
              <dl className="text-xs text-muted-foreground space-y-1">
                <div><dt className="inline font-medium">Source: </dt><dd className="inline">{sel.edge.source_db} ({sel.edge.source_id})</dd></div>
                {sel.edge.edge_valid != null && <div><dt className="inline font-medium">p(valid): </dt><dd className="inline">{pct(sel.edge.edge_valid)}</dd></div>}
                {sel.edge.contradicted != null && <div><dt className="inline font-medium">p(contradicted): </dt><dd className="inline">{pct(sel.edge.contradicted)}</dd></div>}
                {sel.edge.evidence_level && (
                  <div><dt className="font-medium">Evidence level:</dt>
                    <dd>{Object.entries(sel.edge.evidence_level.probs).map(([k, v]) => `${k} ${pct(v)}`).join(" · ")}</dd></div>
                )}
                {sel.edge.supporting_publications.length > 0 && (
                  <div><dt className="inline font-medium">Supporting: </dt><dd className="inline">{sel.edge.supporting_publications.join(", ")}</dd></div>
                )}
                {sel.edge.contradictory_evidence.length > 0 && (
                  <div className="font-medium"><dt className="inline">Contradictory: </dt><dd className="inline">{sel.edge.contradictory_evidence.join(", ")}</dd></div>
                )}
                {sel.edge.state && <div><dt className="font-medium">Evidence snippet:</dt><dd className="italic">{sel.edge.state}</dd></div>}
                {sel.edge.decision_meta && <div>judged by {sel.edge.decision_meta.model} · {sel.edge.decision_meta.question_pack}</div>}
              </dl>
            </>
          )}
        </aside>
      </div>

      <p className="text-xs text-muted-foreground">
        Rendered with sigma.js + graphology (Gephi ecosystem) using ForceAtlas2.{" "}
        <a className="underline underline-offset-4 hover:no-underline" href={`${API_BASE}/api/graph.gexf`}>Download GEXF</a>{" "}
        to open the full graph in Gephi desktop.
      </p>
    </div>
  );
}
