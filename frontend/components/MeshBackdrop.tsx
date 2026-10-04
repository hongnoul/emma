"use client";
// MeshBackdrop: mounts the HeroMesh canvas once at the root layout so it
// persists across route changes (the click-zoom carries straight into
// /disease/[id] with no white reload). Filter state arrives over meshBus
// from ApexHero; match counts flow back the same way.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import HeroMesh from "@/components/HeroMesh";
import { meshBus, MeshFilter } from "@/lib/mesh-bus";

// Linger cap after navigating into /physician. The normal unmount trigger
// is HeroMesh's unfold-done signal (the sphere finished unfolding into the
// map); the cap only catches pathological cases (artifact missing, rAF
// never running) so the decorative canvas can't linger forever.
const PHYSICIAN_LINGER_MAX_MS = 2500;

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
    const done = meshBus.onUnfoldDone(() => setLinger(false));
    const t = setTimeout(() => setLinger(false), PHYSICIAN_LINGER_MAX_MS);
    return () => { done(); clearTimeout(t); };
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
