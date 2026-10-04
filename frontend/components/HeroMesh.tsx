"use client";
// HeroMesh: full-bleed ambient background for the apex landing page.
// Renders the atlas UMAP artifact (/atlas-umap.json) wrapped onto a big
// transparent sphere: judged links as soft colored strands (chords through
// the glass), diseases as faint ink points. The sphere's radius exceeds the
// viewport so it bleeds past every edge and the canvas clips the overflow.
// The canvas itself is click-through (pointer-events: none) so the
// BubbleSelector flow buttons always win; interactivity is implemented
// by listening on window and hit-testing against node positions.
//
// Motion: slow constant spin, cursor-steered yaw/pitch, ambient sinusoidal
// drift ("breath"), local repel near the cursor, and a semantic alpha pulse
// on the review band only. Depth fades back-hemisphere geometry so the
// sphere reads as see-through. Hue never animates: green/amber/red keep
// their triage meaning.
//
// Hover: nearest disease node under the cursor gets a ring highlight, its
// judged links brighten, and a small card (anchored to the node, following
// its drift) names the disease and links to /disease/[id] and triage.
// Hit-testing uses pre-repel base positions, skips the back hemisphere, and
// the hovered node is exempt from repel, so nodes don't flee the cursor.
//
// Filter: the apex search bar passes `filter` (and optional `semanticIds`
// from the backend search) down as props. Matching is recomputed per change
// (substring over names/ids + id union), and the paint loop crossfades: the
// full mesh recedes to a ghost while matched nodes/links draw bright in a
// second batched pass. Hit-testing prefers matched nodes while filtering.
//
// Focus: /disease/[id] routes drive a persistent camera state, not a
// one-shot transition. The focused node docks to the page's MeshStage rect
// (read live each frame via meshBus, so it tracks layout and scroll); deep
// loads dive in on arrival, switching diseases re-targets through a
// zoom-out/zoom-in, and leaving the route eases back to the full sphere.
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { meshBus } from "@/lib/mesh-bus";

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
const ENTRANCE_MS = 900;
// Sphere tuning
const SPHERE = 0.58;    // sphere radius as a fraction of max(W, H)
const SPIN = 0.05;      // constant yaw, rad/s
const YAW = 0.6;        // cursor-x steering range, rad
const PITCH = 0.45;     // cursor-y steering range, rad
const TILT = 0.35;      // base pitch, rad
const DEPTH_A = [0.18, 0.5, 1]; // alpha multiplier per depth bucket (back/mid/front)
const FILTER_DEPTH_A = [0.55, 0.8, 1]; // matched geometry: back hemisphere stays visible
// Hover tuning
const HIT_JUDGED = 20;  // px: prefer judged nodes within this radius
const HIT_ANY = 12;     // px: otherwise any node within this radius
const HIT_MATCHED = 36; // px: filtering active — matched nodes get a big grab radius
// Click-zoom tuning: camera dollies into the clicked node, pans it to
// center, dims unrelated geometry. Navigation fires mid-zoom (the canvas
// persists across routes, so the zoomed mesh is the loading backdrop).
const ZOOM_MS = 700;
const ZOOM_SCALE = 4;   // sphere radius multiplier at full zoom
const NAV_AT = 0.55;    // zoom progress at which router.push fires
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

interface HoverInfo { i: number; id: string; name: string; deg: number }

export default function HeroMesh({
  className = "",
  filter = "",
  semanticIds = null,
  onMatchCount,
}: {
  className?: string;
  /** live query from the apex search bar; "" disables filtering */
  filter?: string;
  /** extra disease ids from the semantic backend search, unioned in */
  semanticIds?: string[] | null;
  /** reports how many nodes match (null = filter inactive) */
  onMatchCount?: (n: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [hover, setHover] = useState<HoverInfo | null>(null);
  // Shared with the data closure below
  const hoverIdx = useRef(-1);
  const placeCard = useRef<(i: number) => void>(() => {});
  // True on the landing page: hover, click-zoom and steering are enabled.
  const activeRef = useRef(pathname === "/");
  // Route-driven focus: /disease/[id] keeps the mesh zoomed on that node.
  const focusCtl = useRef<(id: string | null) => void>(() => {});
  const focusIdOf = (p: string | null) => {
    const m = p?.match(/^\/disease\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const focusIdRef = useRef<string | null>(focusIdOf(pathname));

  useEffect(() => {
    activeRef.current = pathname === "/";
    focusIdRef.current = focusIdOf(pathname);
    focusCtl.current(focusIdRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  // Filter plumbing: props land in refs so the one-shot canvas effect never
  // re-runs; the closure rebinds applyFilterRef once data loads.
  const applyFilterRef = useRef<(q: string, ids: string[] | null) => void>(() => {});
  const filterState = useRef<{ q: string; ids: string[] | null }>({ q: "", ids: null });
  const onMatchCountRef = useRef(onMatchCount);
  onMatchCountRef.current = onMatchCount;

  useEffect(() => {
    filterState.current = {
      q: (filter ?? "").trim().toLowerCase(),
      ids: semanticIds ?? null,
    };
    applyFilterRef.current(filterState.current.q, filterState.current.ids);
  }, [filter, semanticIds]);

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
    // Focus-mode hit test: focused node + its ring neighbors only
    let focusHit: ((x: number, y: number) => number) | null = null;
    let focusSettled = () => false;
    let nodes: HeroNode[] = [];
    // Assigned in the animated path; null (reduced motion) = navigate directly
    let startZoom: ((i: number) => void) | null = null;
    let zoomActive = false;
    let extraCleanup: (() => void) | null = null;
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
        router.prefetch(`/disease/${encodeURIComponent(n.id)}`); // seamless handoff

      } else {
        setHover(null);
      }
    };
    // Rebindable so reduced-motion mode can append a static repaint
    let applyHover = applyHoverBase;
    const setApplyHover = (fn: (i: number) => void) => { applyHover = fn; };

    const onMove = (e: PointerEvent) => {
      const focusMode = !activeRef.current && focusIdRef.current !== null;
      if (!activeRef.current && !focusMode) return; // inert on other pages
      if (activeRef.current && zoomActive) return;  // mid click-zoom on home
      const rect = cv.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (!focusMode && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        target.x = x; target.y = y; target.seen = true;
      }
      if (!canHover || e.pointerType === "touch") return;
      const el = e.target as Element | null;
      if (el?.closest?.("[data-hover-card]")) return; // keep card while mousing into it
      if (el?.closest?.("a,button,input,[data-apex-search]")) { applyHover(-1); return; } // UI wins over mesh
      if (focusMode) {
        // Docked local graph: neighbors are hoverable, no steering
        applyHover(focusSettled() && focusHit ? focusHit(x, y) : -1);
        return;
      }
      applyHover(hitTest ? hitTest(x, y) : -1);
    };
    const onLeave = () => { target.seen = false; applyHover(-1); };
    const onClick = (e: MouseEvent) => {
      const focusMode = !activeRef.current && focusIdRef.current !== null;
      if (!activeRef.current && !focusMode) return;
      if (activeRef.current && zoomActive) return;
      const i = hoverIdx.current;
      if (i < 0 || !nodes[i]) return;
      const el = e.target as Element | null;
      if (el?.closest?.("a,button,input,[data-apex-search],[data-hover-card]")) return;
      if (focusMode) {
        // Clicking a ring neighbor retargets the focus (route drives the camera)
        if (nodes[i].id !== focusIdRef.current) {
          router.push(`/disease/${encodeURIComponent(nodes[i].id)}`);
        }
        return;
      }
      if (startZoom) startZoom(i);
      else router.push(`/disease/${encodeURIComponent(nodes[i].id)}`);
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

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("forceReduced");

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
        // Wrap the flat (u,v) map onto a unit sphere: u -> longitude (full
        // wrap, so half the map faces away at any moment), v -> latitude
        // clamped to +/-1.2 rad so clusters never pile up at the poles.
        const ux = new Float32Array(N), uy = new Float32Array(N), uz = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const lon = xs[i] * Math.PI * 2;
          const lat = (ys[i] - 0.5) * 2.4;
          ux[i] = Math.cos(lat) * Math.sin(lon);
          uy[i] = Math.sin(lat);
          uz[i] = Math.cos(lat) * Math.cos(lon);
        }
        // Rotated depth per node, +1 = nearest. Drives alpha and hit-testing.
        const depth = new Float32Array(N);
        const bucketOf = (z: number) => (z < -0.25 ? 0 : z < 0.3 ? 1 : 2);
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
        // 1-hop neighborhood per node: the focus stage renders this as a
        // legible local graph (neighbors pulled into the stage ring, labeled).
        const nbr = new Map<number, { j: number; v: number }[]>();
        const pushN = (a: number, b: number, v: number) => {
          let arr = nbr.get(a);
          if (!arr) { arr = []; nbr.set(a, arr); }
          arr.push({ j: b, v });
        };
        for (const l of data.links) { pushN(l.s, l.t, l.v); pushN(l.t, l.s, l.v); }
        // Effective focus neighborhood: artifact links unioned with the
        // API's related diseases (pushed over meshBus by the disease page).
        // Nodes without judged artifact links still get their real graph.
        const RING_MAX = 10;
        let fNbr: { j: number; v: number }[] = [];
        let fNbrFor = -1;
        // API-sourced display names for ring neighbors (artifact names can
        // be bare MONDO ids); indexed by node index.
        const apiName = new Map<number, string>();
        const rebuildFocusNbr = () => {
          fNbrFor = zoom.i;
          if (zoom.i < 0) { fNbr = []; return; }
          const seen = new Set<number>();
          const out: { j: number; v: number }[] = [];
          for (const e of nbr.get(zoom.i) ?? []) {
            if (!seen.has(e.j)) { seen.add(e.j); out.push(e); }
          }
          for (const r of meshBus.getFocusRelated() ?? []) {
            const j = idToIdx.get(r.id);
            if (j === undefined) continue;
            if (r.name) apiName.set(j, r.name);
            if (j !== zoom.i && !seen.has(j)) {
              seen.add(j);
              out.push({ j, v: r.v });
            }
          }
          fNbr = out.slice(0, RING_MAX);
        };
        const unsubRelated = meshBus.onFocusRelated(() => { fNbrFor = -2; });
        extraCleanup = unsubRelated;

        // ---- Filter state ----
        // Lowercased search keys + id lookup, built once. recompute() refills
        // the matched set on every query/semantic-id change; the paint loop
        // crossfades via flt.strength (eased toward flt.target each frame).
        const keys = data.nodes.map((n) => (n.n + " " + n.id).toLowerCase());
        const idToIdx = new Map<string, number>();
        data.nodes.forEach((n, i) => idToIdx.set(n.id, i));
        const matched = new Uint8Array(N);
        let matchedIdx = new Int32Array(0);
        // Matched link endpoints per band (links touching a matched node)
        let mBands = { accept: new Int32Array(0), review: new Int32Array(0), low: new Int32Array(0) };
        const flt = { on: false, strength: 0, target: 0 };
        const recompute = (q: string, ids: string[] | null) => {
          flt.on = q.length > 0 || (ids !== null && ids.length > 0);
          flt.target = flt.on ? 1 : 0;
          if (!flt.on) {
            onMatchCountRef.current?.(null);
            return;
          }
          matched.fill(0);
          let count = 0;
          if (q.length > 0) {
            for (let i = 0; i < N; i++) {
              if (keys[i].includes(q)) { matched[i] = 1; count++; }
            }
          }
          if (ids) {
            for (const id of ids) {
              const i = idToIdx.get(id);
              if (i !== undefined && !matched[i]) { matched[i] = 1; count++; }
            }
          }
          const mi = new Int32Array(count);
          for (let i = 0, k = 0; i < N; i++) if (matched[i]) mi[k++] = i;
          matchedIdx = mi;
          const ma: number[] = [], mr: number[] = [], ml: number[] = [];
          for (const l of data.links) {
            if (!matched[l.s] && !matched[l.t]) continue;
            const arr = bandOf(l.v) === "accept" ? ma : bandOf(l.v) === "review" ? mr : ml;
            arr.push(l.s, l.t);
          }
          mBands = {
            accept: new Int32Array(ma),
            review: new Int32Array(mr),
            low: new Int32Array(ml),
          };
          onMatchCountRef.current?.(count);
        };

        // px/py: drawn positions. bx0/by0: base positions before repel
        // (stable under the cursor, used for hit testing).
        const px = new Float32Array(N), py = new Float32Array(N);
        const bx0 = new Float32Array(N), by0 = new Float32Array(N);
        const ctx = cv.getContext("2d")!;
        const t0 = performance.now();
        const R2 = RADIUS * RADIUS;

        hitTest = (mx: number, my: number): number => {
          // While filtering, matched nodes own the cursor entirely: ghosted
          // non-matches are near-invisible, so hovering them is just noise.
          if (flt.on && flt.strength > 0.3) {
            let bestM = -1, bestMD = HIT_MATCHED * HIT_MATCHED;
            for (let k = 0; k < matchedIdx.length; k++) {
              const i = matchedIdx[k];
              if (depth[i] <= -0.6) continue; // matched back nodes stay visible → clickable
              const dx = bx0[i] - mx, dy = by0[i] - my;
              const d = dx * dx + dy * dy;
              if (d < bestMD) { bestMD = d; bestM = i; }
            }
            return bestM;
          }
          let best = -1, bestD = HIT_ANY * HIT_ANY;
          let bestJ = -1, bestJD = HIT_JUDGED * HIT_JUDGED;
          for (let i = 0; i < N; i++) {
            if (depth[i] <= 0.05) continue; // back hemisphere is not clickable
            const dx = bx0[i] - mx, dy = by0[i] - my;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
            if (d < bestJD && data.nodes[i].deg > 0) { bestJD = d; bestJ = i; }
          }
          return bestJ >= 0 ? bestJ : best;
        };

        // Focus camera state: a persistent zoom onto one node, driven by the
        // route (and adopted mid-flight from a click-zoom). target 1 = docked
        // in, 0 = full sphere. pending holds a retarget while easing out.
        // sx/sy = the node's screen position when the dive began (sInit lazy
        // for route-driven dives, where it's only known after a layout pass).
        const zoom = {
          i: -1, target: 0, p: 0, navigated: false,
          yaw: 0, pitch: 0, sx: 0, sy: 0, sInit: false, pending: -1,
        };
        let lastYaw = 0, lastPitch = TILT; // refreshed every layout pass
        // Face-on camera for a node: yaw/pitch that bring it to depth=1
        // (viewport center, front hemisphere). Used for route-driven dives.
        const faceOn = (i: number) => {
          const yaw = Math.atan2(-ux[i], uz[i]);
          const r = Math.hypot(ux[i], uz[i]);
          return { yaw, pitch: Math.atan2(uy[i], r) };
        };
        const dive = (i: number) => {
          const f = faceOn(i);
          zoom.i = i;
          zoom.target = 1;
          zoom.navigated = true; // already on the route
          zoom.yaw = f.yaw;
          zoom.pitch = f.pitch;
          zoom.sInit = false; // resolve sx/sy on the next layout pass
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

        const layoutState = { zooming: false };
        let stageR = 0; // focus ring radius, set per layout pass
        const layout = (t: number, e: number, W: number, H: number, zp = 0) => {
          layoutState.zooming = zoom.i >= 0;
          // Ease cursor toward target; fall back to center when unseen
          const gx = target.seen ? target.x : W / 2;
          const gy = target.seen ? target.y : H / 2;
          smooth.x += (gx - smooth.x) * 0.08;
          smooth.y += (gy - smooth.y) * 0.08;
          // Sphere radius exceeds the half-viewport so edges clip (overflow
          // hidden comes free from the canvas bounds). Entrance scales it up.
          const R = Math.max(W, H) * SPHERE * e * (1 + (ZOOM_SCALE - 1) * zp);
          const cxp = W / 2, cyp = H / 2;
          // Constant spin plus cursor steering of yaw/pitch; frozen mid-zoom
          const zooming = zoom.i >= 0;
          const yaw = zooming ? zoom.yaw : t * SPIN + ((smooth.x / Math.max(W, 1)) - 0.5) * YAW;
          const pitch = zooming ? zoom.pitch : TILT + ((smooth.y / Math.max(H, 1)) - 0.5) * PITCH;
          lastYaw = yaw; lastPitch = pitch;
          const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
          const cpit = Math.cos(pitch), spit = Math.sin(pitch);
          // Pan so the focused node glides from where the dive began to its
          // anchor: the MeshStage rect center when a page registered one
          // (read live, so the node tracks layout and scroll), else the
          // viewport center. The sphere inflates around it.
          let panX = 0, panY = 0;
          if (zooming) {
            const zi = zoom.i;
            const x1 = ux[zi] * cyaw + uz[zi] * syaw;
            const z1 = uz[zi] * cyaw - ux[zi] * syaw;
            const y2 = uy[zi] * cpit - z1 * spit;
            const nx = cxp + x1 * R, ny = cyp + y2 * R;
            if (!zoom.sInit) { zoom.sx = nx; zoom.sy = ny; zoom.sInit = true; }
            const stage = meshBus.getStage();
            let ax = cxp, ay = cyp;
            stageR = Math.min(W, H) * 0.3;
            if (stage) {
              const r = stage.getBoundingClientRect();
              ax = r.left + r.width / 2;
              ay = r.top + r.height / 2;
              stageR = Math.max(90, Math.min(r.width, r.height) * 0.42);
            }
            panX = zoom.sx + (ax - zoom.sx) * zp - nx;
            panY = zoom.sy + (ay - zoom.sy) * zp - ny;
          }
          const driftScale = AMP * e * (1 - zp); // drift settles as we dive in
          const seen = target.seen && !zooming && activeRef.current ? 1 : 0;
          const hi = hoverIdx.current;
          for (let i = 0; i < N; i++) {
            // Rotate: yaw about Y, then pitch about X; orthographic project
            const x1 = ux[i] * cyaw + uz[i] * syaw;
            const z1 = uz[i] * cyaw - ux[i] * syaw;
            const y2 = uy[i] * cpit - z1 * spit;
            depth[i] = uy[i] * spit + z1 * cpit;
            let bx = cxp + x1 * R;
            let by = cyp + y2 * R;
            // Ambient wave
            bx += Math.sin(t * W1 + ys[i] * 3.1 + phase[i]) * driftScale + panX;
            by += Math.cos(t * W2 + xs[i] * 3.1 + phase[i] * 0.7) * driftScale + panY;
            bx0[i] = bx; by0[i] = by;
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
            px[i] = bx;
            py[i] = by;
          }
          // Focus neighborhood: the dolly flings UMAP-distant neighbors far
          // offscreen, so the stage would show a node with amputated links.
          // Re-lay the 1-hop neighbors around the focus preserving meaning:
          // ring radius encodes true UMAP distance (closer in phenotype
          // space = closer to the node), direction is kept from the sphere
          // projection, and angles are only nudged apart the minimum needed
          // for legible labels. Blended by zoom depth.
          if (zooming && zp > 0.01) {
            if (fNbrFor !== zoom.i) rebuildFocusNbr();
            const fx = px[zoom.i], fy = py[zoom.i];
            const ns = fNbr;
            if (ns && ns.length > 0) {
              const m = ns.length;
              // UMAP-space distance per neighbor (unit-sphere chord): the
              // atlas semantics the ring must preserve.
              let dLo = Infinity, dHi = -Infinity;
              const du = new Float32Array(m);
              for (let k = 0; k < m; k++) {
                const j = ns[k].j;
                const dd = Math.hypot(
                  ux[j] - ux[zoom.i], uy[j] - uy[zoom.i], uz[j] - uz[zoom.i],
                );
                du[k] = dd;
                if (dd < dLo) dLo = dd;
                if (dd > dHi) dHi = dd;
              }
              const span = dHi - dLo || 1;
              // Preserve each neighbor's projected direction; sort to nudge
              const order = ns.map(({ j }, k) => ({
                k, j, a: Math.atan2(py[j] - fy, px[j] - fx),
              })).sort((p, q) => p.a - q.a);
              // Minimal angular separation pass (labels need ~0.3 rad)
              const minGap = Math.min((Math.PI * 2) / m, 0.3);
              for (let r = 1; r < m; r++) {
                if (order[r].a - order[r - 1].a < minGap) {
                  order[r].a = order[r - 1].a + minGap;
                }
              }
              // Wrap: last vs first across the 2π seam
              if (m > 1) {
                const wrap = order[0].a + Math.PI * 2 - order[m - 1].a;
                if (wrap < minGap) {
                  const shift = (minGap - wrap) / 2;
                  order[0].a += shift;
                  order[m - 1].a -= shift;
                }
              }
              for (let r = 0; r < m; r++) {
                const { k, j, a } = order[r];
                // Radius maps UMAP distance into the stage: nearest ~0.45R,
                // farthest ~0.95R, so relative proximity stays readable.
                const prox = (du[k] - dLo) / span;
                const tgt = stageR * (0.45 + 0.5 * prox);
                const tx = fx + Math.cos(a) * tgt, ty = fy + Math.sin(a) * tgt;
                px[j] += (tx - px[j]) * zp;
                py[j] += (ty - py[j]) * zp;
              }
            }
          }
        };

        // Reused per-frame depth buckets (avoid allocation in the hot loop)
        const linkBuckets: number[][] = [[], [], []];
        const pointBuckets: number[][] = [[], [], []];
        const strokeBand = (idx: Int32Array, rgb: string, alpha: number, depthA = DEPTH_A) => {
          if (idx.length === 0) return;
          for (const b of linkBuckets) b.length = 0;
          for (let k = 0; k < idx.length; k += 2) {
            const z = (depth[idx[k]] + depth[idx[k + 1]]) * 0.5;
            linkBuckets[bucketOf(z)].push(idx[k], idx[k + 1]);
          }
          ctx.lineWidth = 0.7;
          for (let b = 0; b < 3; b++) {
            const arr = linkBuckets[b];
            if (arr.length === 0) continue;
            ctx.strokeStyle = `rgba(${rgb},${alpha * depthA[b]})`;
            ctx.beginPath();
            for (let k = 0; k < arr.length; k += 2) {
              ctx.moveTo(px[arr[k]], py[arr[k]]);
              ctx.lineTo(px[arr[k + 1]], py[arr[k + 1]]);
            }
            ctx.stroke();
          }
        };
        const fillPoints = (idx: Int32Array, rgb: string, alpha: number, r: number, depthA = DEPTH_A) => {
          if (idx.length === 0) return;
          for (const b of pointBuckets) b.length = 0;
          for (let k = 0; k < idx.length; k++) {
            pointBuckets[bucketOf(depth[idx[k]])].push(idx[k]);
          }
          for (let b = 0; b < 3; b++) {
            const arr = pointBuckets[b];
            if (arr.length === 0) continue;
            const rr = r * (0.7 + 0.3 * b); // smaller when far: depth cue
            ctx.fillStyle = `rgba(${rgb},${alpha * depthA[b]})`;
            ctx.beginPath();
            for (let k = 0; k < arr.length; k++) {
              const i = arr[k];
              ctx.moveTo(px[i] + rr, py[i]);
              ctx.arc(px[i], py[i], rr, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        };

        const paint = (e: number, reviewAlpha: number, zp = 0) => {
          // Unrelated geometry recedes during the zoom; highlight holds
          // and while a filter is active the whole base mesh ghosts out.
          const fs = flt.strength;
          const dim = e * (1 - 0.75 * zp) * (1 - 0.85 * fs);
          // Links: batched per triage band x depth bucket (back fades out)
          strokeBand(bands.accept, LINK_COLOR.accept, 0.18 * dim);
          strokeBand(bands.review, LINK_COLOR.review, (reviewAlpha + 0.02) * dim);
          strokeBand(bands.low, LINK_COLOR.low, 0.15 * dim);
          // Points: judged nodes slightly stronger; back hemisphere ghosts
          fillPoints(plainIdx, "100,116,139", 0.22 * dim, 1.2); // slate-500
          fillPoints(judgedIdx, "67,56,202", 0.45 * dim, 1.9);  // indigo-700

          // Filter pass: matched geometry drawn bright on top of the ghost.
          // Matched nodes punch through the depth fade (FILTER_DEPTH_A) so
          // back-hemisphere results stay visible: a filter must show all hits.
          if (fs > 0.01) {
            const fe = e * fs * (1 - 0.75 * zp);
            strokeBand(mBands.accept, LINK_COLOR.accept, 0.5 * fe, FILTER_DEPTH_A);
            strokeBand(mBands.review, LINK_COLOR.review, 0.45 * fe, FILTER_DEPTH_A);
            strokeBand(mBands.low, LINK_COLOR.low, 0.4 * fe, FILTER_DEPTH_A);
            fillPoints(matchedIdx, "67,56,202", 0.14 * fe, 9, FILTER_DEPTH_A);   // soft halo
            fillPoints(matchedIdx, "67,56,202", 0.95 * fe, 3.2, FILTER_DEPTH_A); // bright core
          }

          // Hover highlight: brighten links touching the node, ring the node.
          // During a zoom the clicked node owns the highlight.
          const hi = zoom.i >= 0 ? zoom.i : hoverIdx.current;
          if (hi >= 0 && zoom.i < 0) {
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

          // Focus pass: the docked node's local graph, drawn legibly. Links
          // to ring-pulled neighbors keep triage colors; neighbors get dots
          // sized by judged degree and, once settled, name labels.
          if (zoom.i >= 0 && zp > 0.01) {
            const fi = zoom.i;
            const ns = fNbr;
            const fa = zp * e;
            ctx.lineWidth = 1.3;
            for (const { j, v } of ns) {
              ctx.strokeStyle = `rgba(${LINK_COLOR[bandOf(v)]},${0.8 * fa})`;
              ctx.beginPath();
              ctx.moveTo(px[fi], py[fi]);
              ctx.lineTo(px[j], py[j]);
              ctx.stroke();
            }
            const hovI = hoverIdx.current;
            for (const { j } of ns) {
              const r = j === hovI ? 5 : 3.4;
              ctx.fillStyle = `rgba(67,56,202,${(j === hovI ? 0.95 : 0.65) * fa})`;
              ctx.beginPath();
              ctx.arc(px[j], py[j], r, 0, Math.PI * 2);
              ctx.fill();
            }
            // Labels once the dock has mostly settled (avoid mid-flight noise)
            if (zp > 0.7) {
              const la = (zp - 0.7) / 0.3 * e;
              ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
              ctx.textBaseline = "middle";
              for (const { j } of ns) {
                const n = nodes[j];
                const name = apiName.get(j) ?? (n.n.startsWith("MONDO:") ? n.id : n.n);
                const label = name.length > 26 ? name.slice(0, 25) + "\u2026" : name;
                const left = px[j] < px[fi];
                ctx.textAlign = left ? "right" : "left";
                const tx = px[j] + (left ? -8 : 8);
                const w = ctx.measureText(label).width;
                ctx.fillStyle = `rgba(255,255,255,${0.75 * la})`;
                ctx.fillRect(left ? tx - w - 3 : tx - 3, py[j] - 8, w + 6, 16);
                ctx.fillStyle = `rgba(51,65,85,${(j === hovI ? 1 : 0.85) * la})`;
                ctx.fillText(label, tx, py[j]);
              }
            }
            // Focused node core + ring on top
            ctx.fillStyle = `rgba(67,56,202,${0.95 * fa})`;
            ctx.beginPath();
            ctx.arc(px[fi], py[fi], 4.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(67,56,202,${0.55 * fa})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(px[fi], py[fi], 9, 0, Math.PI * 2);
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
          // Static frame: settled entrance, no spin or cursor response.
          // Hover still works (positions are static). Repaint on resize and
          // on hover change so the highlight renders.
          const renderStatic = () => {
            const size = sizeCanvas();
            if (!size) return;
            // t=0, settled entrance; cursor unseen so smooth stays centered
            smooth.x = size.W / 2;
            smooth.y = size.H / 2;
            flt.strength = flt.target; // no easing without a frame loop
            layout(0, 1, size.W, size.H);
            paint(1, 0.17);
          };
          // Filter changes repaint the static frame directly
          applyFilterRef.current = (q, ids) => { recompute(q, ids); renderStatic(); };
          const fs0 = filterState.current;
          if (fs0.q || fs0.ids?.length) recompute(fs0.q, fs0.ids);
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

        // Filter changes recompute the match set; the running loop picks the
        // crossfade up via flt.strength easing. Apply any query typed before
        // the artifact finished loading.
        applyFilterRef.current = (q, ids) => recompute(q, ids);
        {
          const fs0 = filterState.current;
          if (fs0.q || fs0.ids?.length) recompute(fs0.q, fs0.ids);
        }

        // Focus-mode interactivity: hit test over the docked local graph
        // (focused node + ring neighbors), active once the dock settles.
        focusSettled = () => zoom.i >= 0 && zoom.target === 1 && zoom.p > 0.85;
        focusHit = (mx: number, my: number): number => {
          if (zoom.i < 0) return -1;
          const R2n = 14 * 14;
          let best = -1, bestD = R2n;
          for (const { j } of fNbr) {
            const dx = px[j] - mx, dy = py[j] - my;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = j; }
          }
          return best;
        };

        startZoom = (i: number) => {
          zoomActive = true;
          zoom.i = i;
          zoom.target = 1;
          zoom.p = 0;
          zoom.navigated = false;
          zoom.pending = -1;
          zoom.yaw = lastYaw;
          zoom.pitch = lastPitch;
          zoom.sx = bx0[i];
          zoom.sy = by0[i];
          zoom.sInit = true;
          applyHover(-1); // drop the card; the canvas ring carries the focus
        };

        // Route-driven focus. A /disease/[id] route keeps the mesh docked on
        // that node as persistent state: deep loads dive in, switching
        // diseases retargets through a zoom-out/zoom-in, leaving the route
        // eases back to the full sphere. A click-zoom already in flight for
        // the same node is adopted rather than restarted.
        focusCtl.current = (id: string | null) => {
          target.seen = false;
          applyHover(-1);
          const idx = id !== null ? (idToIdx.get(id) ?? -1) : -1;
          if (idx < 0) {
            // No focus (home or unknown node): ease out if zoomed
            zoom.pending = -1;
            if (zoom.i >= 0) { zoom.target = 0; zoom.navigated = false; }
            return;
          }
          zoomActive = true;
          if (zoom.i === idx) {
            zoom.target = 1; // adopt the in-flight click-zoom
            zoom.navigated = true;
          } else if (zoom.i >= 0) {
            zoom.pending = idx; // retarget: out, then dive into the new node
            zoom.target = 0;
          } else {
            dive(idx);
          }
        };
        // Deep load: the route effect ran before the artifact arrived
        if (focusIdRef.current) focusCtl.current(focusIdRef.current);

        let prevNow = t0;

        const loop = (now: number) => {
          if (cancelled || !running) return;
          const size = sizeCanvas();
          if (size) {
            const t = (now - t0) / 1000;
            const dt = Math.min(0.1, (now - prevNow) / 1000);
            prevNow = now;
            const e = 1 - Math.pow(1 - Math.min(1, (now - t0) / ENTRANCE_MS), 3); // easeOutCubic
            // Focus progress: eased dolly toward target (1 = docked, 0 =
            // full sphere). Click-zooms navigate mid-dive; the canvas
            // persists across the route change so the motion carries over.
            let zp = 0;
            if (zoom.i >= 0) {
              const dir = zoom.target === 1 ? 1 : -1;
              zoom.p = Math.min(1, Math.max(0, zoom.p + (dir * dt * 1000) / ZOOM_MS));
              zp = easeInOut(zoom.p);
              if (zoom.target === 1 && !zoom.navigated && zoom.p >= NAV_AT) {
                zoom.navigated = true;
                router.push(`/disease/${encodeURIComponent(nodes[zoom.i].id)}`);
              }
              if (zoom.target === 0 && zoom.p <= 0) {
                if (zoom.pending >= 0) {
                  const nxt = zoom.pending;
                  zoom.pending = -1;
                  dive(nxt); // retarget: now dive into the new focus
                } else {
                  zoom.i = -1;
                  zoomActive = false;
                }
              }
            }
            layout(t, e, size.W, size.H, zp);
            // Ease the filter crossfade toward its target
            flt.strength += (flt.target - flt.strength) * 0.12;
            if (Math.abs(flt.target - flt.strength) < 0.005) flt.strength = flt.target;
            // Review band breathes 0.12..0.22 on a 4s cycle; accept/low hold steady
            const reviewAlpha = 0.17 + 0.05 * Math.sin((t * Math.PI * 2) / 4);
            paint(e, reviewAlpha, zp);
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
      .catch((err) => {
        // decorative: fail silently to a plain white hero, but surface the
        // reason in dev so motion/hover bugs aren't invisible
        if (process.env.NODE_ENV !== "production") console.error("[HeroMesh]", err);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      extraCleanup?.();
      applyFilterRef.current = () => {};
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
      {/* Persistent full-bleed backdrop: white base, warm wash, mesh canvas.
          Fixed at -z-10 so every route's content stacks above it, and the
          canvas never remounts across navigations (no white reload). */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-white">
        <div className="absolute -left-32 top-1/4 size-[480px] rounded-full bg-indigo-200/40 blur-3xl" />
        <div className="absolute -right-32 bottom-1/4 size-[480px] rounded-full bg-amber-100/60 blur-3xl" />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full ${className}`}
        />
      </div>
      {/* Hover card: anchored to the hovered node, follows its drift.
          Fixed and z-30 so it stacks above page content and stays clickable. */}
      {hover && (
        <div
          ref={cardRef}
          data-hover-card
          className="pointer-events-auto fixed left-0 top-0 z-30 w-60 rounded-lg border border-slate-200 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-sm"
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
