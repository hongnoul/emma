"use client";
// Interactive knowledge graph (Cytoscape). One file, no component tree.
import { use, useEffect, useRef, useState } from "react";
import cytoscape, { Core } from "cytoscape";
import { api, GraphEdge, GraphNode, NODE_COLORS, NodeType, pct } from "@/lib/api";

const ALL_TYPES = Object.keys(NODE_COLORS) as NodeType[];

export default function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set());
  const [sel, setSel] = useState<{ kind: "node"; node: GraphNode } | { kind: "edge"; edge: GraphEdge } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.diseaseGraph(id, 2).then(setData).catch((e) => setError(String(e))); }, [id]);

  useEffect(() => {
    if (!data || !container.current) return;
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    const edgeById = new Map(data.edges.map((e) => [e.id, e]));
    const cy = cytoscape({
      container: container.current,
      elements: [
        ...data.nodes.map((n) => ({ data: { id: n.id, label: n.name, type: n.type } })),
        ...data.edges.map((e) => ({ data: { id: e.id, source: e.source, target: e.target, rel: e.rel_type, inferred: e.provenance === "inferred" } })),
      ],
      style: [
        { selector: "node", style: {
          "background-color": (el) => NODE_COLORS[el.data("type") as NodeType] ?? "#999",
          label: "data(label)", "font-size": 8, "text-wrap": "ellipsis", "text-max-width": "80",
          width: 18, height: 18, "text-valign": "bottom", "text-margin-y": 4,
        }},
        { selector: "node[type='Disease']", style: { width: 30, height: 30, "font-size": 10 } },
        { selector: "edge", style: {
          width: 1.5, "line-color": "#cbd5e1", "curve-style": "bezier",
          label: "data(rel)", "font-size": 5, color: "#94a3b8",
        }},
        { selector: "edge[?inferred]", style: { "line-style": "dashed", "line-color": "#f59e0b" } },
        { selector: ":selected", style: { "border-width": 3, "border-color": "#1d4ed8", "line-color": "#1d4ed8" } },
      ],
      layout: { name: "cose", animate: false, nodeRepulsion: () => 8000 },
    });
    cy.on("tap", "node", (ev) => { const n = nodeById.get(ev.target.id()); if (n) setSel({ kind: "node", node: n }); });
    cy.on("tap", "edge", (ev) => { const e = edgeById.get(ev.target.id()); if (e) setSel({ kind: "edge", edge: e }); });
    cy.on("tap", (ev) => { if (ev.target === cy) setSel(null); });
    cyRef.current = cy;
    return () => { cy.destroy(); };
  }, [data]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !data) return;
    cy.nodes().forEach((n) => {
      const t = n.data("type") as NodeType;
      n.style("display", hidden.has(t) ? "none" : "element");
    });
  }, [hidden, data]);

  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!data) return <p className="text-slate-500">Loading graph…</p>;

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
        <button onClick={() => cyRef.current?.fit()} className="rounded px-2 py-1 border border-slate-300 ml-2">Center</button>
        <button onClick={() => { setHidden(new Set()); cyRef.current?.layout({ name: "cose", animate: false }).run(); cyRef.current?.fit(); }}
          className="rounded px-2 py-1 border border-slate-300">Reset</button>
        <span className="text-slate-400 ml-auto">dashed amber = atlas-inferred</span>
      </div>

      <div className="flex gap-4">
        <div ref={container} className="flex-1 h-[560px] border border-slate-200 rounded-lg" />
        <aside className="w-80 shrink-0 border border-slate-200 rounded-lg p-4 text-sm space-y-2 overflow-y-auto max-h-[560px]">
          {!sel && <p className="text-slate-400">Click a node or edge for details.</p>}
          {sel?.kind === "node" && (
            <>
              <h3 className="font-semibold">{sel.node.name}</h3>
              <p><span className="text-xs rounded px-1.5 py-0.5 text-white" style={{ background: NODE_COLORS[sel.node.type] }}>{sel.node.type}</span></p>
              <p className="text-xs text-slate-500">{sel.node.identifier}</p>
              <p className="text-slate-700">{sel.node.description}</p>
              <p className="text-xs text-slate-400">Source: synthetic demo dataset</p>
            </>
          )}
          {sel?.kind === "edge" && (
            <>
              <h3 className="font-semibold">{sel.edge.rel_type}</h3>
              <p className="text-slate-700">{sel.edge.description}</p>
              <p className="text-xs">
                <span className={`rounded px-1.5 py-0.5 ${sel.edge.provenance === "inferred" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                  {sel.edge.provenance === "inferred" ? "ATLAS-INFERRED CONNECTION" : "DIRECT / CURATED EVIDENCE"}
                </span>
              </p>
              <dl className="text-xs text-slate-600 space-y-1">
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
                  <div className="text-red-700"><dt className="inline font-medium">Contradictory: </dt><dd className="inline">{sel.edge.contradictory_evidence.join(", ")}</dd></div>
                )}
                {sel.edge.state && <div><dt className="font-medium">Evidence snippet:</dt><dd className="italic text-slate-500">{sel.edge.state}</dd></div>}
                {sel.edge.decision_meta && <div className="text-slate-400">judged by {sel.edge.decision_meta.model} · {sel.edge.decision_meta.question_pack}</div>}
              </dl>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
