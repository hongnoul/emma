"use client";
// HeroMesh: full-bleed ambient background for the apex landing page.
// Renders the atlas UMAP artifact (/atlas-umap.json) as a light, airy mesh on
// a white background: judged links as soft colored strands, diseases as faint
// ink points. Decorative only (pointer-events: none) - the apex page routes
// users through the BubbleMenu selector instead.
import { useCallback, useEffect, useRef, useState } from "react";

interface HeroNode { id: string; n: string; x: number; y: number; deg: number }
interface HeroLink { id: string; s: number; t: number; v: number }
interface HeroData { generation_id: string; nodes: HeroNode[]; links: HeroLink[] }

type Band = "accept" | "review" | "low";
const bandOf = (v: number): Band => (v >= 0.9 ? "accept" : v >= 0.6 ? "review" : "low");
// Light-theme strand colors (same triage semantics as AtlasHero, toned down).
const LINK_COLOR: Record<Band, string> = {
  accept: "16,145,80", review: "202,128,8", low: "220,56,56",
};

export default function HeroMesh({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<HeroData | null>(null);
  const anim = useRef(0);
  const entranceRaf = useRef<number>(0);
  const norm = useRef<{ xs: Float32Array; ys: Float32Array } | null>(null);

  useEffect(() => {
    fetch("/atlas-umap.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => {}); // decorative: fail silently to a plain white hero
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

    const nm = norm.current;
    const pad = -40; // overscan so the mesh bleeds past every edge
    const e = 1 - Math.pow(1 - anim.current, 3); // easeOutCubic entrance
    const sx = (i: number) => {
      const nx = 0.5 + (nm.xs[i] - 0.5) * e;
      return pad + nx * (W - 2 * pad);
    };
    const sy = (i: number) => {
      const ny = 0.5 + (nm.ys[i] - 0.5) * e;
      return pad + ny * (H - 2 * pad);
    };

    // links: soft colored strands
    for (const l of data.links) {
      const b = bandOf(l.v);
      ctx.strokeStyle = `rgba(${LINK_COLOR[b]},${0.16 * e})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(sx(l.s), sy(l.s));
      ctx.lineTo(sx(l.t), sy(l.t));
      ctx.stroke();
    }

    // points: faint ink, judged nodes slightly stronger
    for (let i = 0; i < data.nodes.length; i++) {
      const x = sx(i), y = sy(i);
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      const judged = data.nodes[i].deg > 0;
      ctx.fillStyle = judged
        ? `rgba(67,56,202,${0.4 * e})`   // indigo-700
        : `rgba(100,116,139,${0.18 * e})`; // slate-500
      ctx.beginPath();
      ctx.arc(x, y, judged ? 1.9 : 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [data]);

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
    const t0 = performance.now();
    const tick = (t: number) => {
      anim.current = Math.min(1, (t - t0) / 900);
      draw();
      if (anim.current < 1) entranceRaf.current = requestAnimationFrame(tick);
    };
    entranceRaf.current = requestAnimationFrame(tick);
    const settle = window.setTimeout(() => { anim.current = 1; draw(); }, 1100);
    return () => { cancelAnimationFrame(entranceRaf.current); clearTimeout(settle); };
  }, [data, draw]);

  // redraw on resize
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
