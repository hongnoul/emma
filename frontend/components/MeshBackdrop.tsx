"use client";
// MeshBackdrop: mounts the HeroMesh canvas once at the root layout so it
// persists across route changes (the click-zoom carries straight into
// /disease/[id] with no white reload). Filter state arrives over meshBus
// from ApexHero; match counts flow back the same way.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import HeroMesh from "@/components/HeroMesh";
import { meshBus, MeshFilter } from "@/lib/mesh-bus";

// How long the mesh stays mounted after navigating into /physician: long
// enough to cover HeroMesh's ~650ms unfold departure plus the shell's
// background fade (see globals.css .physician-canvas), so the sphere
// visibly unfolds into the map before the workbench paints over it.
const PHYSICIAN_LINGER_MS = 800;

export default function MeshBackdrop() {
  const pathname = usePathname();
  const [filter, setFilter] = useState<MeshFilter>(meshBus.getFilter());
  useEffect(() => meshBus.onFilter(setFilter), []);

  // The physician workbench paints an opaque muted canvas over the whole
  // viewport, so the mesh would animate for zero visible pixels. Skip it —
  // but when arriving *from* another route (the apex handoff), linger
  // briefly under the shell's background fade before unmounting.
  //
  // Linger must flip during render, not in an effect: an effect-driven flag
  // would return null for one commit, unmounting HeroMesh and losing the
  // persistent canvas the unfold animation runs on (setState-in-render is
  // the supported "derived state from props" pattern).
  const onPhysician = pathname.startsWith("/physician");
  const [prevPath, setPrevPath] = useState(pathname);
  const [linger, setLinger] = useState(false);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    if (onPhysician && !prevPath.startsWith("/physician")) {
      meshBus.markHandoff();
      setLinger(true);
    }
  }
  useEffect(() => {
    if (!linger) return;
    const t = setTimeout(() => setLinger(false), PHYSICIAN_LINGER_MS);
    return () => clearTimeout(t);
  }, [linger]);
  if (onPhysician && !linger) return null;
  return (
    <HeroMesh
      filter={filter.q}
      semanticIds={filter.ids}
      onMatchCount={meshBus.setMatchCount}
    />
  );
}
