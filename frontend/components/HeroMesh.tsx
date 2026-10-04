"use client";
// HeroMesh: full-bleed ambient background for the apex landing page.
// Renders the atlas UMAP artifact (/atlas-umap.json) as a living mesh on a
// white background: judged links as soft colored strands, diseases as faint
// ink points. The canvas itself is click-through (pointer-events: none) so
// the BubbleSelector flow buttons always win; interactivity is implemented
// by listening on window and hit-testing against node positions.
//
// Motion: ambient sinusoidal drift ("breath"), cursor wake (global parallax
// plus local repel), and a semantic alpha pulse on the review band only.
// Hue never animates: green/amber/red keep their triage meaning.
//
// Hover: nearest disease node under the cursor gets a ring highlight, its
// judged links brighten, and a small card (anchored to the node, following
// its drift) names the disease and links to /disease/[id] and triage.
// Hit-testing uses pre-repel base positions and the hovered node is exempt
// from repel, so nodes don't flee the cursor that is trying to reach them.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
// Hover tuning
const HIT_JUDGED = 20;  // px: prefer judged nodes within this radius
const HIT_ANY = 12;     // px: otherwise any node within this radius

interface HoverInfo { i: number; id: string; name: string; deg: number }

export default function HeroMesh({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // Shared with the data closure below
  const hoverIdx = useRef(-1);
  const placeCard = useRef<(i: number) => void>(() => {});

  // Body cursor hints clickability even though the canvas is click-through
  useEffect(() => {
    document.body.style.cursor = hover ? "pointer" : "";
    return () => { document.body.style.cursor = ""; };
  }, [hover]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let cancelled = false;
    let raf = 0;
    let running = true; // paused when offscreen / tab hidden
    let kick: (now: number) => void = () => {}; // assigned once data loads
    let staticRO: ResizeObserver | null = null; // reduced-motion repaint
    // Assigned once data loads; hit test in canvas-relative px
    let hitTest: ((x: number, y: number) => number) | null = null;
    let nodes: HeroNode[] = [];
    const canHover = window.matchMedia("(hover: hover)").matches;

    // Smoothed cursor in canvas-relative px; target updated on pointermove.
    const target = { x: 0, y: 0, seen: false };
    const smooth = { x: 0, y: 0 };
    let lastHover = -1;

    const applyHoverBase = (i: number) => {
      if (i === lastHover) return;
      lastHover = i;
      hoverIdx.current = i;
      if (i >= 0) {
        const n = nodes[i];
        setHover({ i, id: n.id, name: n.n.startsWith("MONDO:") ? n.id : n.n, deg: n.deg });
        placeCard.current(i);
      } else {
        setHover(null);
      }
    };
    // Rebindable so reduced-motion mode can append a static repaint
    let applyHover = applyHoverBase;
    const setApplyHover = (fn: (i: number) => void) => { applyHover = fn; };

    const onMove = (e: PointerEvent) => {
      const rect = cv.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        target.x = x; target.y = y; target.seen = true;
      }
      if (!canHover || e.pointerType === "touch") return;
      const el = e.target as Element | null;
      if (el?.closest?.("[data-hover-card]")) return; // keep card while mousing into it
      if (el?.closest?.("a,button")) { applyHover(-1); return; } // UI wins over mesh
      applyHover(hitTest ? hitTest(x, y) : -1);
    };
    const onLeave = () => { target.seen = false; applyHover(-1); };
    const onClick = (e: MouseEvent) => {
      const i = hoverIdx.current;
      if (i < 0 || !nodes[i]) return;
      const el = e.target as Element | null;
      if (el?.closest?.("a,button,[data-hover-card]")) return;
      router.push(`/disease/${encodeURIComponent(nodes[i].id)}`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("click", onClick);
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
        nodes = data.nodes;
        const N = data.nodes.length;
        // Normalize once. Raw min/max lets a few outliers stretch the scale
        // (the UMAP x distribution is heavily right-shifted, leaving the left
        // quarter of the viewport nearly empty). Instead: clamp to the 1st-99th
        // percentile, then blend linear position 50/50 with rank (histogram
        // equalization) so the mesh fills the frame while clusters stay legible.
        const EQ = 0.5; // 0 = pure UMAP geometry, 1 = fully equalized
        const normalize = (vals: number[]): Float32Array => {
          const n = vals.length;
          const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
          const lo = vals[order[Math.floor(0.01 * (n - 1))]];
          const hi = vals[order[Math.floor(0.99 * (n - 1))]];
          const span = hi - lo || 1;
          const out = new Float32Array(n);
          for (let r = 0; r < n; r++) {
            const i = order[r];
            const lin = Math.min(1, Math.max(0, (vals[i] - lo) / span));
            out[i] = (1 - EQ) * lin + (EQ * r) / (n - 1);
          }
          return out;
        };
        const xs = normalize(data.nodes.map((n) => n.x));
        const ys = normalize(data.nodes.map((n) => n.y));
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

        // px/py: drawn positions. bx0/by0: base positions before repel
        // (stable under the cursor, used for hit testing).
        const px = new Float32Array(N), py = new Float32Array(N);
        const bx0 = new Float32Array(N), by0 = new Float32Array(N);
        const ctx = cv.getContext("2d")!;
        const t0 = performance.now();
        const R2 = RADIUS * RADIUS;

        hitTest = (mx: number, my: number): number => {
          let best = -1, bestD = HIT_ANY * HIT_ANY;
          let bestJ = -1, bestJD = HIT_JUDGED * HIT_JUDGED;
          for (let i = 0; i < N; i++) {
            const dx = bx0[i] - mx, dy = by0[i] - my;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
            if (d < bestJD && data.nodes[i].deg > 0) { bestJD = d; bestJ = i; }
          }
          return bestJ >= 0 ? bestJ : best;
        };

        placeCard.current = (i: number) => {
          const el = cardRef.current;
          if (!el || i < 0) return;
          const W = cv.clientWidth, H = cv.clientHeight;
          const cw = el.offsetWidth || 240, ch = el.offsetHeight || 90;
          let x = px[i] + 16, y = py[i] + 14;
          if (x + cw > W - 8) x = px[i] - cw - 16;
          if (y + ch > H - 8) y = py[i] - ch - 14;
          el.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`;
        };

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
          const hi = hoverIdx.current;
          for (let i = 0; i < N; i++) {
            const nx = 0.5 + (xs[i] - 0.5) * e;
            const ny = 0.5 + (ys[i] - 0.5) * e;
            let bx = pad + nx * spanW;
            let by = pad + ny * spanH;
            // Ambient wave
            bx += Math.sin(t * W1 + ys[i] * 3.1 + phase[i]) * driftScale;
            by += Math.cos(t * W2 + xs[i] * 3.1 + phase[i] * 0.7) * driftScale;
            bx0[i] = bx + ox; by0[i] = by + oy;
            // Local repel around the smoothed cursor; the hovered node is
            // exempt so it stays pinned under the pointer.
            if (seen && i !== hi) {
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

          // Hover highlight: brighten links touching the node, ring the node
          const hi = hoverIdx.current;
          if (hi >= 0) {
            ctx.lineWidth = 1.2;
            for (const l of data.links) {
              if (l.s !== hi && l.t !== hi) continue;
              ctx.strokeStyle = `rgba(${LINK_COLOR[bandOf(l.v)]},${0.75 * e})`;
              ctx.beginPath();
              ctx.moveTo(px[l.s], py[l.s]);
              ctx.lineTo(px[l.t], py[l.t]);
              ctx.stroke();
            }
            ctx.fillStyle = `rgba(67,56,202,${0.9 * e})`;
            ctx.beginPath();
            ctx.arc(px[hi], py[hi], 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(67,56,202,${0.5 * e})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px[hi], py[hi], 7.5, 0, Math.PI * 2);
            ctx.stroke();
          }
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
          // Hover still works (positions are static). Repaint on resize and
          // on hover change so the highlight renders.
          const renderStatic = () => {
            const size = sizeCanvas();
            if (!size) return;
            const pad = -40;
            for (let i = 0; i < N; i++) {
              px[i] = pad + xs[i] * (size.W - 2 * pad);
              py[i] = pad + ys[i] * (size.H - 2 * pad);
              bx0[i] = px[i]; by0[i] = py[i];
            }
            paint(1, 0.17);
          };
          renderStatic();
          staticRO = new ResizeObserver(() => renderStatic());
          staticRO.observe(cv);
          // Re-render highlight when hover changes (cheap, event-driven)
          setApplyHover((i: number) => {
            applyHoverBase(i);
            renderStatic();
            if (i >= 0) placeCard.current(i);
          });
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
            // Card follows its node's drift
            if (hoverIdx.current >= 0) placeCard.current(hoverIdx.current);
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
      window.removeEventListener("click", onClick);
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
      {/* Hover card: anchored to the hovered node, follows its drift.
          pointer-events-auto so the user can mouse into it and click. */}
      {hover && (
        <div
          ref={cardRef}
          data-hover-card
          className="pointer-events-auto absolute left-0 top-0 z-20 w-60 rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-sm"
        >
          <p className="truncate text-[13px] font-medium text-slate-900">{hover.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {hover.deg > 0
              ? `${hover.deg} judged connection${hover.deg > 1 ? "s" : ""}`
              : "no judged edges yet"}
          </p>
          <div className="mt-2 flex gap-2">
            <a
              href={`/disease/${encodeURIComponent(hover.id)}`}
              className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-100"
            >
              Open disease →
            </a>
            {hover.deg > 0 && (
              <a
                href={`/physician/triage?node=${encodeURIComponent(hover.id)}`}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-200"
              >
                Triage
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
