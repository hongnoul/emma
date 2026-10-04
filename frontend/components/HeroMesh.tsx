"use client";
// HeroMesh: full-bleed ambient background for the apex landing page.
// Renders the atlas UMAP artifact (/atlas-umap.json) as a living mesh on a
// white background: judged links as soft colored strands, diseases as faint
// ink points. Decorative only (pointer-events: none) - the apex page routes
// users through the BubbleMenu selector instead.
//
// Motion: ambient sinusoidal drift ("breath"), cursor wake (global parallax
// plus local repel, tracked on window since the canvas itself is click-through),
// and a semantic alpha pulse on the review band only. Hue never animates:
// green/amber/red keep their triage meaning.
import { useEffect, useRef } from "react";

interface HeroNode { id: string; n: string; x: number; y: number; deg: number }
interface HeroLink { id: string; s: number; t: number; v: number }
interface HeroData { generation_id: string; nodes: HeroNode[]; links: HeroLink[] }

type Band = "accept" | "review" | "low";
const bandOf = (v: number): Band => (v >= 0.9 ? "accept" : v >= 0.6 ? "review" : "low");
// Light-theme strand colors (same triage semantics as AtlasHero, toned down).
const LINK_COLOR: Record<Band, string> = {
  accept: "16,145,80", review: "202,128,8", low: "220,56,56",
};

// Motion tuning
const AMP = 8;          // drift amplitude, px
const W1 = 0.9;         // drift angular freq, rad/s (~0.14 Hz)
const W2 = 0.7;
const RADIUS = 140;     // cursor repel radius, px
const PUSH = 26;        // max repel displacement, px
const PARALLAX = 14;    // max global shift opposite cursor, px
const ENTRANCE_MS = 900;

export default function HeroMesh({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let cancelled = false;
    let raf = 0;
    let running = true; // paused when offscreen / tab hidden
    let kick: (now: number) => void = () => {}; // assigned once data loads
    let staticRO: ResizeObserver | null = null; // reduced-motion repaint

    // Smoothed cursor in canvas-relative px; target updated on pointermove.
    // Defaults to center so parallax rests at zero.
    const target = { x: 0, y: 0, seen: false };
    const smooth = { x: 0, y: 0 };

    const onMove = (e: PointerEvent) => {
      const rect = cv.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        target.x = x; target.y = y; target.seen = true;
      }
    };
    const onLeave = () => { target.seen = false; };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);

    const io = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting && document.visibilityState === "visible";
      if (visible && !running) { running = true; raf = requestAnimationFrame(kick); }
      else if (!visible && running) { running = false; cancelAnimationFrame(raf); }
    });
    io.observe(cv);
    const onVis = () => {
      const visible = document.visibilityState === "visible";
      if (visible && !running) { running = true; raf = requestAnimationFrame(kick); }
      else if (!visible && running) { running = false; cancelAnimationFrame(raf); }
    };
    document.addEventListener("visibilitychange", onVis);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    fetch("/atlas-umap.json")
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<HeroData>; })
      .then((data) => {
        if (cancelled) return;
        // Normalize once
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of data.nodes) {
          if (n.x < minX) minX = n.x; if (n.x > maxX) maxX = n.x;
          if (n.y < minY) minY = n.y; if (n.y > maxY) maxY = n.y;
        }
        const N = data.nodes.length;
        const xs = new Float32Array(N), ys = new Float32Array(N);
        data.nodes.forEach((n, i) => {
          xs[i] = (n.x - minX) / (maxX - minX);
          ys[i] = (n.y - minY) / (maxY - minY);
        });
        // Per-point phase so the drift doesn't move in lockstep
        const phase = new Float32Array(N);
        for (let i = 0; i < N; i++) phase[i] = Math.random() * Math.PI * 2;
        // Group link endpoints by band for batched strokes (one path per band)
        const acc: number[] = [], rev: number[] = [], low: number[] = [];
        for (const l of data.links) {
          const arr = bandOf(l.v) === "accept" ? acc : bandOf(l.v) === "review" ? rev : low;
          arr.push(l.s, l.t);
        }
        const bands = {
          accept: new Int32Array(acc),
          review: new Int32Array(rev),
          low: new Int32Array(low),
        };
        // Split point indices by judged state for batched fills
        const judged: number[] = [], plain: number[] = [];
        data.nodes.forEach((n, i) => { (n.deg > 0 ? judged : plain).push(i); });
        const judgedIdx = new Int32Array(judged), plainIdx = new Int32Array(plain);

        const px = new Float32Array(N), py = new Float32Array(N);
        const ctx = cv.getContext("2d")!;
        const t0 = performance.now();
        const R2 = RADIUS * RADIUS;

        const layout = (t: number, e: number, W: number, H: number) => {
          const pad = -40; // overscan so the mesh bleeds past every edge
          const spanW = W - 2 * pad, spanH = H - 2 * pad;
          // Ease cursor toward target; fall back to center when unseen
          const gx = target.seen ? target.x : W / 2;
          const gy = target.seen ? target.y : H / 2;
          smooth.x += (gx - smooth.x) * 0.08;
          smooth.y += (gy - smooth.y) * 0.08;
          // Global parallax: whole mesh drifts opposite the cursor
          const ox = ((smooth.x / Math.max(W, 1)) - 0.5) * -2 * PARALLAX * e;
          const oy = ((smooth.y / Math.max(H, 1)) - 0.5) * -2 * PARALLAX * e;
          const driftScale = AMP * e;
          const seen = target.seen ? 1 : 0;
          for (let i = 0; i < N; i++) {
            const nx = 0.5 + (xs[i] - 0.5) * e;
            const ny = 0.5 + (ys[i] - 0.5) * e;
            let bx = pad + nx * spanW;
            let by = pad + ny * spanH;
            // Ambient wave
            bx += Math.sin(t * W1 + ys[i] * 3.1 + phase[i]) * driftScale;
            by += Math.cos(t * W2 + xs[i] * 3.1 + phase[i] * 0.7) * driftScale;
            // Local repel around the smoothed cursor
            if (seen) {
              const rx = bx - smooth.x, ry = by - smooth.y;
              const d2 = rx * rx + ry * ry;
              if (d2 < R2 && d2 > 0.01) {
                const d = Math.sqrt(d2);
                const f = 1 - d / RADIUS;
                const push = f * f * PUSH * e;
                bx += (rx / d) * push;
                by += (ry / d) * push;
              }
            }
            px[i] = bx + ox;
            py[i] = by + oy;
          }
        };

        const strokeBand = (idx: Int32Array, style: string) => {
          if (idx.length === 0) return;
          ctx.strokeStyle = style;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          for (let k = 0; k < idx.length; k += 2) {
            ctx.moveTo(px[idx[k]], py[idx[k]]);
            ctx.lineTo(px[idx[k + 1]], py[idx[k + 1]]);
          }
          ctx.stroke();
        };

        const paint = (e: number, reviewAlpha: number) => {
          // Links: one batched path per triage band
          strokeBand(bands.accept, `rgba(${LINK_COLOR.accept},${0.16 * e})`);
          strokeBand(bands.review, `rgba(${LINK_COLOR.review},${reviewAlpha * e})`);
          strokeBand(bands.low, `rgba(${LINK_COLOR.low},${0.13 * e})`);
          // Points: judged nodes slightly stronger
          ctx.fillStyle = `rgba(100,116,139,${0.18 * e})`; // slate-500
          ctx.beginPath();
          for (let k = 0; k < plainIdx.length; k++) {
            const i = plainIdx[k];
            ctx.moveTo(px[i] + 1.2, py[i]);
            ctx.arc(px[i], py[i], 1.2, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.fillStyle = `rgba(67,56,202,${0.4 * e})`; // indigo-700
          ctx.beginPath();
          for (let k = 0; k < judgedIdx.length; k++) {
            const i = judgedIdx[k];
            ctx.moveTo(px[i] + 1.9, py[i]);
            ctx.arc(px[i], py[i], 1.9, 0, Math.PI * 2);
          }
          ctx.fill();
        };

        const sizeCanvas = () => {
          const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
          const W = cv.clientWidth, H = cv.clientHeight;
          if (W === 0 || H === 0) return null;
          if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
            cv.width = Math.round(W * dpr);
            cv.height = Math.round(H * dpr);
          }
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);
          return { W, H };
        };

        if (reduced) {
          // Static frame: settled entrance, no drift or cursor response.
          // Repaint on resize so the mesh always fills the hero.
          const renderStatic = () => {
            const size = sizeCanvas();
            if (!size) return;
            const pad = -40;
            for (let i = 0; i < N; i++) {
              px[i] = pad + xs[i] * (size.W - 2 * pad);
              py[i] = pad + ys[i] * (size.H - 2 * pad);
            }
            paint(1, 0.17);
          };
          renderStatic();
          staticRO = new ResizeObserver(() => renderStatic());
          staticRO.observe(cv);
          return;
        }

        // Seed cursor at center so the first frames don't jump
        smooth.x = cv.clientWidth / 2;
        smooth.y = cv.clientHeight / 2;

        const loop = (now: number) => {
          if (cancelled || !running) return;
          const size = sizeCanvas();
          if (size) {
            const t = (now - t0) / 1000;
            const e = 1 - Math.pow(1 - Math.min(1, (now - t0) / ENTRANCE_MS), 3); // easeOutCubic
            layout(t, e, size.W, size.H);
            // Review band breathes 0.12..0.22 on a 4s cycle; accept/low hold steady
            const reviewAlpha = 0.17 + 0.05 * Math.sin((t * Math.PI * 2) / 4);
            paint(e, reviewAlpha);
          }
          raf = requestAnimationFrame(loop);
        };
        const frame = (now: number) => loop(now);
        kick = frame;
        if (running && document.visibilityState === "visible") {
          raf = requestAnimationFrame(frame);
        } else {
          running = false;
        }
      })
      .catch(() => {}); // decorative: fail silently to a plain white hero

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      staticRO?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Warm wash behind the mesh: two blurred blobs for color richness */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 top-1/4 size-[480px] rounded-full bg-indigo-200/40 blur-3xl" />
        <div className="absolute -right-32 bottom-1/4 size-[480px] rounded-full bg-amber-100/60 blur-3xl" />
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      />
    </>
  );
}
