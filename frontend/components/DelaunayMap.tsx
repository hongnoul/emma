"use client";
// Voronoi similarity map: every pixel belongs to exactly one disease.
// Cell fill = dominant channel; dark strokes = true graph edges;
// click a cell to highlight its graph neighbors.
import { useEffect, useMemo, useRef, useState } from "react";
import { CHANNEL_COLOR, MapData, voronoiCells } from "@/lib/delaunay-map";

export default function DelaunayMap({ data }: { data: MapData | null }) {
  const ref = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  const W = 560;
  const H = 560;

  const cells = useMemo(() => {
    if (!data) return null;
    return voronoiCells(data.nodes, W, H);
  }, [data]);

  const [hover, setHover] = useState<string | null>(null);
  const active = hover ?? sel;
  const neighbors = useMemo(() => {
    if (!data || !active) return new Set<string>();
    const s = new Set<string>([active]);
    for (const e of data.edges) {
      if (e.a === active) s.add(e.b);
      if (e.b === active) s.add(e.a);
    }
    return s;
  }, [data, active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!data || !cells) return <p className="text-xs text-slate-500">loading map…</p>;
  const idx = new Map(data.nodes.map((n, i) => [n.id, i]));

  return (
    <div className="space-y-1">
      <svg
        ref={ref} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        className="border border-slate-700 rounded w-full max-w-[560px] bg-slate-950"
      >
        {data.nodes.map((n, i) => {
          const poly = cells.vor.renderCell(i);
          const dim = active && !neighbors.has(n.id);
          return (
            <path
              key={n.id} d={poly}
              fill={CHANNEL_COLOR[n.channel] ?? "#475569"}
              fillOpacity={dim ? 0.12 : n.id === active ? 0.95 : 0.55}
              stroke={n.id === active ? "#fff" : "#0f172a"}
              strokeWidth={n.id === active ? 2.5 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSel(n.id === sel ? null : n.id)}
              style={{ cursor: "pointer" }}
            >
              <title>{`${n.id} ${n.name} · deg ${n.degree} · ${n.channel}`}</title>
            </path>
          );
        })}
        {/* true graph edges overlay */}
        {data.edges.map((e, i) => {
          const a = data.nodes[idx.get(e.a)!];
          const b = data.nodes[idx.get(e.b)!];
          if (!a || !b) return null;
          const lit = active && (e.a === active || e.b === active);
          const dim = active && !lit;
          return (
            <line
              key={i}
              x1={a.x * W} y1={a.y * H} x2={b.x * W} y2={b.y * H}
              stroke={e.rel === "PHENOTYPE_SIMILAR" ? "#fbbf24" : "#0f172a"}
              strokeOpacity={dim ? 0.05 : lit ? 1 : active ? 0.55 : 0.08}
              strokeWidth={lit ? 2.5 : 1}
              pointerEvents="none"
            />
          );
        })}
        {data.nodes.map((n) => (
          n.degree >= 6 || n.id === active ? (
            <text
              key={"t" + n.id} x={n.x * W} y={n.y * H}
              textAnchor="middle" fontSize={9} fill="#fff" pointerEvents="none"
              stroke="#0f172a" strokeWidth={2} paintOrder="stroke"
            >
              {n.name.slice(0, 18)}
            </text>
          ) : null
        ))}
      </svg>
      <div className="text-xs text-slate-400 max-w-[560px]">
        {active ? (
          <p>
            <span className="text-slate-200 font-medium">{data.nodes[idx.get(active)!]?.name}</span>
            {" "}{active} · degree {data.nodes[idx.get(active)!]?.degree} · {neighbors.size - 1} graph neighbors highlighted
            {" "}(click empty or Esc to clear)
          </p>
        ) : (
          <p>hover to preview · click a cell to lock its graph neighborhood</p>
        )}
        <p className="text-slate-500">{data.delaunayNote}</p>
      </div>
    </div>
  );
}
