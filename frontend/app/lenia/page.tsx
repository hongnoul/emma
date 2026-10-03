"use client";
// Prototype: enumerate all Lenia scenes of prod (fly.io) atlas data.
// No layout polish. One page, all scenes stacked, each with its own canvas.
import { useEffect, useState } from "react";
import LeniaCanvas, { DEFAULTS, LeniaParams } from "@/components/LeniaCanvas";
import {
  PROD, SceneData, sceneContest, sceneDetail, sceneEvals,
  sceneEvidence, sceneOpps, scenePath, sceneSwarm,
} from "@/lib/lenia-atlas";

const FOCAL = "MONDO:0018149"; // GM1 gangliosidosis (rich prod anchor)
const RIVAL = "MONDO:0018938"; // mucopolysaccharidosis type 4
const CONTEST = "MONDO:0017739"; // disorder of lysosomal-related organelles

function useScene(loader: () => Promise<SceneData>, deps: string) {
  const [scene, setScene] = useState<SceneData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loader().then((s) => live && setScene(s)).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps]);
  return { scene, err };
}

function Block({ title, hint, scene, err, params, legend, meta }: {
  title: string; hint: string; scene: SceneData | null; err: string | null;
  params: LeniaParams; legend?: boolean; meta?: boolean;
}) {
  return (
    <section className="border-t border-slate-700 pt-4 space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-xs text-slate-400">{hint}</p>
      {err && <p className="text-red-500 text-xs">{err}</p>}
      {!scene && !err && <p className="text-xs text-slate-500">fetching {PROD}…</p>}
      {scene && (
        <div className="flex gap-6 flex-wrap">
          <LeniaCanvas scene={scene} params={params} seedKey={title} />
          <div className="text-xs space-y-2 max-w-sm">
            {meta !== false && scene.meta.map((m, i) => <p key={i} className="text-slate-300">{m}</p>)}
            {legend !== false && (
              <ul className="space-y-1">
                {scene.legend.slice(0, 14).map((l, i) => (
                  <li key={i} className="flex gap-2 items-center">
                    {l.label > 0 && (
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: scene.palette[l.label % scene.palette.length] }} />
                    )}
                    <span className="text-slate-400">{l.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-slate-500">seeds: {scene.seeds.length}</p>
          </div>
        </div>
      )}
    </section>
  );
}

export default function LeniaScenesPage() {
  const [mu, setMu] = useState(DEFAULTS.mu);
  const [sigma, setSigma] = useState(DEFAULTS.sigma);
  const [speed, setSpeed] = useState(DEFAULTS.speed);
  const params: LeniaParams = { ...DEFAULTS, mu, sigma, speed };

  const s1 = useScene(() => sceneDetail(FOCAL), FOCAL);
  const s2 = useScene(() => sceneSwarm(FOCAL, 2), FOCAL);
  const s3 = useScene(() => sceneContest(CONTEST, 4), CONTEST);
  const s4 = useScene(() => sceneEvidence(CONTEST), CONTEST);
  const s5 = useScene(() => scenePath(FOCAL, RIVAL), FOCAL + RIVAL);
  const s6 = useScene(() => sceneEvals(), "evals");
  const s7 = useScene(() => sceneOpps(FOCAL), FOCAL);

  return (
    <div className="space-y-8 max-w-6xl text-slate-200">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Lenia × Atlas (prototype, prod data)</h1>
        <p className="text-xs text-slate-400">
          source: {PROD} · focal {FOCAL} · contest {CONTEST} · path {FOCAL}→{RIVAL} ·
          each canvas is a live simulation: hue = atlas type, brightness = field mass
        </p>
        <div className="flex gap-4 text-xs pt-2">
          <label>mu {mu.toFixed(2)} <input type="range" min={0.1} max={0.5} step={0.01} value={mu} onChange={(e) => setMu(+e.target.value)} /></label>
          <label>sigma {sigma.toFixed(3)} <input type="range" min={0.01} max={0.15} step={0.005} value={sigma} onChange={(e) => setSigma(+e.target.value)} /></label>
          <label>speed {speed} <input type="range" min={1} max={12} step={1} value={speed} onChange={(e) => setSpeed(+e.target.value)} /></label>
        </div>
      </header>

      <Block title="1 · organism — disease detail as one creature"
        hint="center = disease; orbiting blobs = genes / phenotypes / pathways / mechanisms. Same kernel+growth for all blobs, so fusion/fission is the data talking."
        scene={s1.scene} err={s1.err} params={params} />
      <Block title="2 · swarm — neighborhood graph as cohabiting species"
        hint="one creature per graph node (cap 42 of ~80), color = node type. Shared field = shared physics; watch which types clump."
        scene={s2.scene} err={s2.err} params={params} legend={false} />
      <Block title="3 · contest — focal vs top-related by similarity distance"
        hint="challenger distance = 1 - similarity. Close = similar. Stable coexistence vs absorption = visual similarity check."
        scene={s3.scene} err={s3.err} params={params} />
      <Block title="4 · evidence weather — touching edges tune the field"
        hint="seed size/amp ~ p(valid); green = curated, amber = inferred. Empty/dirVALID-less on prod = honest: default physics + a note."
        scene={s4.scene} err={s4.err} params={params} />
      <Block title="5 · path wave — connection route as a left-to-right pulse"
        hint="left = source disease, right = target, mid blobs = path nodes; color = type. Pulse order = hop order."
        scene={s5.scene} err={s5.err} params={params} />
      <Block title="6 · evals — reliability bands (honest empty state)"
        hint="prod bulk graph has zero judged edges, so the field stays empty by design. Not a bug: no p(valid) to visualize."
        scene={s6.scene} err={s6.err} params={params} legend={false} />
      <Block title="7 · opportunities — reuse spores (honest empty state)"
        hint="prod returns [] for sampled diseases, so the field stays empty by design. Spore size would be validation burden."
        scene={s7.scene} err={s7.err} params={params} />
    </div>
  );
}
