"use client";
// Physician partition home: the graph's nodes are the main section, grouped
// by type with judged-edge context. Band stats and the three workflow entry
// points (triage, edge workbench, path inspector) are compact secondary rows.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { v1, Meta, EdgesResponse } from "@/lib/v1";
import { api, GraphNode, GraphEdge, NodeType } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// Display order: clinical entities first, literature/infrastructure last.
const TYPE_ORDER: NodeType[] = [
  "Disease", "Gene", "Variant", "Phenotype", "Mechanism", "Pathway",
  "ClinicalTrial", "Publication", "Researcher", "PatientOrganization", "ResearchAsset",
];

export default function PhysicianHome() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bands, setBands] = useState<{ established: number; review: number; hidden: number } | null>(null);
  const [nodes, setNodes] = useState<GraphNode[] | null>(null);
  const [edges, setEdges] = useState<GraphEdge[] | null>(null);
  const [filter, setFilter] = useState("");
  const [activeType, setActiveType] = useState<NodeType | "all">("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    v1.meta().then(setMeta).catch((e) => setError(String(e)));
    api.graph()
      .then((g) => { setNodes(g.nodes); setEdges(g.edges); })
      .catch((e) => setError(String(e)));
    Promise.all([
      v1.edges({ judged_only: true, min_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, min_valid: 0.4, max_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, max_valid: 0.4, limit: 1 }),
    ]).then(([a, r, l]: EdgesResponse[]) =>
      setBands({ established: a.total, review: r.total, hidden: l.total })
    ).catch(() => { /* non-fatal */ });
  }, []);

  // Per-node degree + judged review-band count: lets the list surface which
  // nodes actually need physician attention.
  const nodeStats = useMemo(() => {
    const stats = new Map<string, { degree: number; review: number }>();
    if (!edges) return stats;
    for (const e of edges) {
      for (const id of [e.source, e.target]) {
        const s = stats.get(id) ?? { degree: 0, review: 0 };
        s.degree += 1;
        if (e.edge_valid != null && e.edge_valid >= 0.4 && e.edge_valid < 0.9) s.review += 1;
        stats.set(id, s);
      }
    }
    return stats;
  }, [edges]);

  const typeCounts = useMemo(() => {
    const counts = new Map<NodeType, number>();
    for (const n of nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [nodes]);

  const visible = useMemo(() => {
    if (!nodes) return null;
    const q = filter.trim().toLowerCase();
    return nodes
      .filter((n) => (activeType === "all" || n.type === activeType) &&
        (!q || n.name.toLowerCase().includes(q) || (n.description ?? "").toLowerCase().includes(q)))
      .sort((a, b) => {
        const sa = nodeStats.get(a.id), sb = nodeStats.get(b.id);
        return (sb?.review ?? 0) - (sa?.review ?? 0) ||
               (sb?.degree ?? 0) - (sa?.degree ?? 0) ||
               a.name.localeCompare(b.name);
      });
  }, [nodes, filter, activeType, nodeStats]);

  if (error) return <p className="text-sm font-medium">{error}</p>;

  const judgeLive = meta?.judge && meta.judge !== "none";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Evidence interrogation workbench</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Every node below sits in a judged graph. Pick a node to triage its
          uncertain connections, or jump straight into a workflow.
        </p>
        {meta && (
          <p className="text-xs text-muted-foreground">
            generation <span className="font-mono">{meta.generation_id}</span> ·{" "}
            {meta.nodes.toLocaleString()} nodes · {meta.edges.toLocaleString()} edges ·{" "}
            judge:{" "}
            <span className={judgeLive ? "font-medium text-foreground" : ""}>
              {judgeLive ? `${meta.judge} (live)` : "offline — stored judgments only"}
            </span>
          </p>
        )}
      </header>

      {bands && (
        <section className="grid max-w-2xl grid-cols-3 gap-2 sm:gap-4">
          {[
            ["established ≥ 0.90", bands.established, "bg-primary text-primary-foreground"],
            ["review 0.40–0.90", bands.review, "bg-secondary text-secondary-foreground border"],
            ["hidden < 0.40", bands.hidden, "border border-dashed text-muted-foreground"],
          ].map(([label, n, cls]) => (
            <div key={label as string} className={`rounded-lg p-3 text-center ${cls}`}>
              <p className="text-xl font-semibold">{(n as number).toLocaleString()}</p>
              <p className="text-xs">{label}</p>
            </div>
          ))}
        </section>
      )}

      {/* ---- main section: the nodes ---- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            Nodes{visible && <span className="ml-2 text-sm font-normal text-muted-foreground">{visible.length}</span>}
          </h2>
          <Input
            className="h-9 w-full max-w-xs"
            placeholder="Filter nodes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <TypePill label={`all (${nodes?.length ?? "…"})`} active={activeType === "all"}
            onClick={() => setActiveType("all")} />
          {TYPE_ORDER.filter((t) => typeCounts.has(t)).map((t) => (
            <TypePill key={t} label={`${t} (${typeCounts.get(t)})`} active={activeType === t}
              onClick={() => setActiveType(activeType === t ? "all" : t)} />
          ))}
        </div>

        {!visible ? (
          <p className="text-sm text-muted-foreground">Loading graph…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No nodes match.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-background">
            {visible.map((n) => {
              const s = nodeStats.get(n.id);
              return (
                <li key={n.id}>
                  <Link
                    href={`/physician/triage?node=${encodeURIComponent(n.id)}`}
                    className="block px-4 py-2.5 transition hover:bg-muted"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">
                        {n.name}
                        <Badge variant="secondary" className="ml-2 align-middle text-[10px]">{n.type}</Badge>
                      </span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {s ? `${s.degree} edge${s.degree === 1 ? "" : "s"}` : "–"}
                        {s && s.review > 0 && (
                          <span className="ml-2 rounded border px-1.5 py-0.5 text-[10px] text-foreground">
                            {s.review} to review
                          </span>
                        )}
                      </span>
                    </div>
                    {n.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.description}</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- secondary: workflow entry points ---- */}
      <section className="grid gap-2 sm:grid-cols-3">
        <WorkflowLink href="/physician/triage" title="Triage queue"
          body="j/k · a/r through the review band." />
        <WorkflowLink href="/physician/triage" title="Edge workbench"
          body="Decision block, ablation, what-if editor." />
        <WorkflowLink href="/physician/paths" title="Path inspector"
          body="Hop probabilities and the weakest link." />
      </section>

      <p className="text-xs text-muted-foreground max-w-2xl">
        Decision semantics: p(valid) is a calibrated probability, not a fact claim.
        Check <Link className="underline underline-offset-4 hover:no-underline" href="/evals">the calibration report</Link> before
        gating clinical workflows on any threshold.
      </p>
    </div>
  );
}

function TypePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? "bg-primary text-primary-foreground border-primary"
               : "bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function WorkflowLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="rounded-lg border bg-background px-4 py-3 transition hover:border-foreground/30 hover:shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{body}</p>
    </Link>
  );
}
