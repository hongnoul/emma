"use client";
// AtlasHero: interactive UMAP "map of rare disease space" for the landing page.
// 4.7k diseases positioned by umap-learn over IC-weighted phenotype profiles
// (backend/pipeline/umap_hero.py), with judged PHENOTYPE_SIMILAR links colored
// by triage band. Canvas 2D: links first, then points. Hover = tooltip,
// click node -> /physician/triage?node=, click link -> /physician/edge/[id].
// Design: docs/hero-umap-plan.md. Artifact: /atlas-umap.json (keyed by
// generation_id; if it mismatches the live API we still render but note it).
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface HeroNode { id: string; n: string; x: number; y: number; deg: number }
interface HeroLink { id: string; s: number; t: number; v: number }
interface HeroData { generation_id: string; nodes: HeroNode[]; links: HeroLink[] }

type Band = "accept" | "review" | "low";
const bandOf = (v: number): Band => (v >= 0.9 ? "accept" : v >= 0.6 ? "review" : "low");
const LINK_COLOR: Record<Band, string> = {
  accept: "34,197,94", review: "245,158,11", low: "239,68,68",
};

interface Hit { kind: "node"; i: number } // nearest-node hit (links resolved via its edges)

export default function AtlasHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [data, setData] = useState<HeroData | null>(null);
  const [failed, setFailed] = useState(false);
  const [bandFilter, setBandFilter] = useState<Band | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string; href: string } | null>(null);

  // view transform (pan/zoom) and entrance animation progress, in refs so
  // redraws don't re-render React.
  const view = useRef({ k: 1, tx: 0, ty: 0 });
  const anim = useRef(0); // 0..1 entrance
  const hover = useRef<Hit | null>(null);
  const bandRef = useRef<Band | null>(null);
  const raf = useRef<number>(0);

  useEffect(() => {
    fetch("/atlas-umap.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => { bandRef.current = bandFilter; schedule(); }, [bandFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // normalized coords [0,1] computed once
  const norm = useRef<{ xs: Float32Array; ys: Float32Array } | null>(null);
  useEffect(() => {
    if (!data) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of data.nodes) {
      if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
    }
    const xs = new Float32Array(data.nodes.length);
    const ys = new Float32Array(data.nodes.length);
    data.nodes.forEach((n, i) => {
      xs[i] = (n.x - minX) / (maxX - minX);
      ys[i] = (n.y - minY) / (maxY - minY);
    });
    norm.current = { xs, ys };
    // entrance: ease points out from center over ~700ms
    const t0 = performance.now();
    const tick = (t: number) => {
      anim.current = Math.min(1, (t - t0) / 700);
      draw();
      if (anim.current < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const screenXY = useCallback((i: number, W: number, H: number): [number, number] => {
    const nm = norm.current!;
    const { k, tx, ty } = view.current;
    const pad = 24;
    const e = 1 - Math.pow(1 - anim.current, 3); // easeOutCubic
    const nx = 0.5 + (nm.xs[i] - 0.5) * e;
    const ny = 0.5 + (nm.ys[i] - 0.5) * e;
    return [(pad + nx * (W - 2 * pad)) * k + tx, (pad + ny * (H - 2 * pad)) * k + ty];
  }, []);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !data || !norm.current) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr; cv.height = H * dpr;
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const bf = bandRef.current;
    const hv = hover.current;
    const hoverNode = hv?.i ?? -1;

    // links
    for (const l of data.links) {
      const b = bandOf(l.v);
      const active = bf === null || bf === b;
      const touchesHover = hoverNode >= 0 && (l.s === hoverNode || l.t === hoverNode);
      if (!active && !touchesHover) continue;
      const [x1, y1] = screenXY(l.s, W, H);
      const [x2, y2] = screenXY(l.t, W, H);
      const alpha = touchesHover ? 0.9 : bf === b ? 0.55 : bf === null ? 0.28 : 0.05;
      ctx.strokeStyle = `rgba(${LINK_COLOR[b]},${alpha})`;
      ctx.lineWidth = touchesHover ? 1.4 : 0.6;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }

    // points
    for (let i = 0; i < data.nodes.length; i++) {
      const [x, y] = screenXY(i, W, H);
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      const d = data.nodes[i].deg;
      const r = i === hoverNode ? 4.5 : d > 0 ? 2.1 : 1.3;
      ctx.fillStyle = i === hoverNode ? "#ffffff"
        : d > 0 ? "rgba(199,210,254,0.85)" : "rgba(148,163,184,0.45)";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }, [data, screenXY]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => draw());
  }, [draw]);

  // resize
  useEffect(() => {
    const ro = new ResizeObserver(schedule);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [schedule]);

  // hit test: nearest judged node within 14px, else nearest node within 8px
  const hitTest = useCallback((mx: number, my: number): Hit | null => {
    const cv = canvasRef.current;
    if (!cv || !data || !norm.current) return null;
    const W = cv.clientWidth, H = cv.clientHeight;
    let best = -1, bestD = 14 * 14, bestJudged = -1, bestJD = 14 * 14;
    for (let i = 0; i < data.nodes.length; i++) {
      const [x, y] = screenXY(i, W, H);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) { bestD = d; best = i; }
      if (data.nodes[i].deg > 0 && d < bestJD) { bestJD = d; bestJudged = i; }
    }
    const pick = bestJudged >= 0 ? bestJudged : bestD <= 64 ? best : -1;
    return pick >= 0 ? { kind: "node", i: pick } : null;
  }, [data, screenXY]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const hit = hitTest(mx, my);
    const prev = hover.current?.i;
    hover.current = hit;
    if (hit) {
      const n = data!.nodes[hit.i];
      setTip({
        x: mx, y: my,
        title: n.n.startsWith("MONDO:") ? n.id : n.n,
        sub: n.deg > 0 ? `${n.deg} judged connection${n.deg > 1 ? "s" : ""} · click to triage` : "no judged edges yet",
        href: `/physician/triage?node=${encodeURIComponent(n.id)}`,
      });
    } else setTip(null);
    if (prev !== hit?.i) schedule();
  }, [data, hitTest, schedule]);

  const onClick = useCallback(() => {
    const hit = hover.current;
    if (!hit || !data) return;
    router.push(`/physician/triage?node=${encodeURIComponent(data.nodes[hit.i].id)}`);
  }, [data, router]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const v = view.current;
    const k2 = Math.min(8, Math.max(1, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // zoom around cursor
    v.tx = mx - ((mx - v.tx) / v.k) * k2;
    v.ty = my - ((my - v.ty) / v.k) * k2;
    v.k = k2;
    if (k2 === 1) { v.tx = 0; v.ty = 0; }
    schedule();
  }, [schedule]);

  const dragging = useRef<{ x: number; y: number } | null>(null);
  const onDown = useCallback((e: React.PointerEvent) => {
    dragging.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onDragMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current && view.current.k > 1) {
      view.current.tx += e.clientX - dragging.current.x;
      view.current.ty += e.clientY - dragging.current.y;
      dragging.current = { x: e.clientX, y: e.clientY };
      schedule();
    } else onMove(e);
  }, [onMove, schedule]);
  const onUp = useCallback((e: React.PointerEvent) => {
    const d = dragging.current;
    dragging.current = null;
    if (d && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 4) onClick();
  }, [onClick]);

  if (failed) return null; // graceful: landing page works without the hero

  const counts = data
    ? data.links.reduce((a, l) => { a[bandOf(l.v)]++; return a; }, { accept: 0, review: 0, low: 0 } as Record<Band, number>)
    : null;

  return (
    <div ref={wrapRef} className="relative rounded-xl overflow-hidden bg-slate-950 border border-slate-800"
         style={{ height: "min(62vh, 560px)" }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full touch-none"
        style={{ cursor: tip ? "pointer" : "default" }}
        onPointerMove={onDragMove}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerLeave={() => { hover.current = null; dragging.current = null; setTip(null); schedule(); }}
        onWheel={onWheel}
      />

      {/* overlay copy */}
      <div className="absolute top-0 left-0 p-5 sm:p-7 pointer-events-none select-none max-w-md">
        <h2 className="text-white text-xl sm:text-2xl font-semibold drop-shadow">
          The map of rare disease space
        </h2>
        <p className="text-slate-300 text-xs sm:text-sm mt-1 drop-shadow">
          {data ? `${data.nodes.length.toLocaleString()} diseases positioned by phenotype profile (UMAP). ` : ""}
          Links are AI-judged similarity claims, colored by calibrated confidence.
        </p>
        {counts && (
          <div className="flex gap-2 mt-3 pointer-events-auto">
            {([["accept", "≥0.90"], ["review", "0.60–0.90"], ["low", "<0.60"]] as [Band, string][]).map(([b, rng]) => (
              <button key={b}
                onClick={() => setBandFilter(bandFilter === b ? null : b)}
                className={`text-[11px] px-2 py-1 rounded-full border transition ${
                  bandFilter === b ? "ring-1 ring-white/60" : ""} ${
                  b === "accept" ? "bg-green-500/15 border-green-500/40 text-green-300"
                  : b === "review" ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                  : "bg-red-500/15 border-red-500/40 text-red-300"}`}>
                {counts[b].toLocaleString()} {b} {rng}
              </button>
            ))}
          </div>
        )}
        <a href="/physician/triage"
           className="pointer-events-auto inline-block mt-3 text-xs font-medium text-indigo-200 bg-indigo-500/20 border border-indigo-400/40 rounded-full px-3 py-1.5 hover:bg-indigo-500/30 transition">
          Start triaging the review band →
        </a>
      </div>

      {/* tooltip */}
      {tip && (
        <div className="absolute pointer-events-none bg-slate-900/95 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-100 shadow-lg"
             style={{ left: Math.min(tip.x + 12, (wrapRef.current?.clientWidth ?? 600) - 220), top: tip.y + 12, maxWidth: 210 }}>
          <p className="font-medium truncate">{tip.title}</p>
          <p className="text-slate-400">{tip.sub}</p>
        </div>
      )}

      <p className="absolute bottom-2 right-3 text-[10px] text-slate-500 pointer-events-none select-none">
        UMAP of IC-weighted phenotype profiles — proximity suggests, never asserts · scroll to zoom
      </p>
    </div>
  );
}
