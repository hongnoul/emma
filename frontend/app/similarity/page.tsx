"use client";
// Voronoi similarity map: position from data, adjacency from geometry.
// Separate design experiment (d3-delaunay + SVG).
import { useEffect, useState } from "react";
import DelaunayMap from "@/components/DelaunayMap";
import { MapData, similarityMap, CHANNEL_COLOR, PROD_UPSTREAM } from "@/lib/delaunay-map";

const FOCAL = "MONDO:0017739";

export default function SimilarityPage() {
  const [map, setMap] = useState<MapData | null>(null);
  const [mapErr, setMapErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    similarityMap(FOCAL, 2).then((m) => live && setMap(m)).catch((e) => live && setMapErr(String(e)));
    return () => { live = false; };
  }, []);

  return (
    <div className="space-y-8 max-w-6xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Similarity map</h1>
        <p className="text-xs text-muted-foreground">
          source: {PROD_UPSTREAM} · focal {FOCAL} ·
          every pixel belongs to exactly one disease · fill = dominant channel ·
          dark lines = true graph edges · click a cell to lock its neighborhood
        </p>
      </header>
      <section className="space-y-2">
        {mapErr && <p className="text-xs font-medium">{mapErr}</p>}
        {!map && !mapErr && <p className="text-xs text-muted-foreground">fetching map…</p>}
        {map && (
          <div className="flex gap-6 flex-wrap">
            <DelaunayMap data={map} />
            <div className="text-xs space-y-2 max-w-sm">
              {map.meta.map((m, i) => <p key={i} className="text-muted-foreground">{m}</p>)}
              <ul className="space-y-1">
                {Object.entries(CHANNEL_COLOR).map(([k, v]) => (
                  <li key={k} className="flex gap-2 items-center">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: v }} />
                    <span className="text-muted-foreground">{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
