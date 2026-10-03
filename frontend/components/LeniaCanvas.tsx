"use client";
// One Lenia canvas: field (mass) + label (hue) rendering, toroidal grid.
import { useEffect, useRef, useState } from "react";
import {
  applySeeds, SceneData,
} from "@/lib/lenia-atlas";
import { fieldMass, hexToRgb, makeKernel, stepLenia } from "@/lib/lenia";

export interface LeniaParams { mu: number; sigma: number; beta: number[]; R: number; dt: number; speed: number; N: number }

export const DEFAULTS: LeniaParams = { mu: 0.28, sigma: 0.06, beta: [1], R: 10, dt: 0.12, speed: 6, N: 144 };

export default function LeniaCanvas({
  scene, params, seedKey,
}: {
  scene: SceneData | null; params: LeniaParams; seedKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(true);
  const [tick, setTick] = useState(0);
  const [mass, setMass] = useState(0);
  const stateRef = useRef<{ a: Float32Array; u: Float32Array; lab: Uint8Array } | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const runningRef = useRef(running);
  runningRef.current = running;

  // (re)seed when scene or layout changes
  useEffect(() => {
    if (!scene) return;
    const N = paramsRef.current.N;
    const a = new Float32Array(N * N);
    const u = new Float32Array(N * N);
    const lab = new Uint8Array(N * N);
    applySeeds(a, lab, N, scene.seeds);
    stateRef.current = { a, u, lab };
    setTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, seedKey, params.N]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let kernel = makeKernel(DEFAULTS.R, DEFAULTS.beta);
    let kkey = "";
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const st = stateRef.current;
      if (!st || !runningRef.current) return;
      const p = paramsRef.current;
      const kk = `${p.R}:${p.beta.join(",")}`;
      if (kk !== kkey) { kernel = makeKernel(p.R, p.beta); kkey = kk; }
      for (let s = 0; s < p.speed; s++) stepLenia(st.a, st.u, p.N, kernel, p.mu, p.sigma, p.dt);
      const N = p.N;
      const img = ctx.createImageData(N, N);
      const pal = (scene?.palette ?? ["#000"]).map(hexToRgb);
      const px = img.data;
      for (let i = 0; i < N * N; i++) {
        const v = st.a[i];
        const c = pal[st.lab[i] % pal.length] ?? [255, 255, 255];
        // additive-ish glow: background dark, organism tinted by label
        px[i * 4] = Math.min(255, c[0] * v + v * 60);
        px[i * 4 + 1] = Math.min(255, c[1] * v + v * 60);
        px[i * 4 + 2] = Math.min(255, c[2] * v + v * 80);
        px[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      setMass(fieldMass(st.a));
      setTick((t) => t + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene]);

  return (
    <div className="space-y-1">
      <canvas
        ref={canvasRef} width={params.N} height={params.N}
        className="border border-slate-800 rounded w-full max-w-[560px] aspect-square bg-black"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="flex gap-2 text-xs items-center">
        <button onClick={() => setRunning((r) => !r)} className="border border-slate-300 rounded px-2 py-1">
          {running ? "pause" : "run"}
        </button>
        <span className="text-slate-400">t={tick} mass={mass.toFixed(3)}</span>
        <button
          onClick={() => {
            const st = stateRef.current; if (!st || !scene) return;
            applySeeds(st.a, st.lab, params.N, scene.seeds);
          }}
          className="border border-slate-300 rounded px-2 py-1"
        >
          reseed
        </button>
      </div>
    </div>
  );
}
