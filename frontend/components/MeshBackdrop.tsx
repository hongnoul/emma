"use client";
// MeshBackdrop: mounts the HeroMesh canvas once at the root layout so it
// persists across route changes (the click-zoom carries straight into
// /disease/[id] with no white reload). Filter state arrives over meshBus
// from ApexHero; match counts flow back the same way.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import HeroMesh from "@/components/HeroMesh";
import { meshBus, MeshFilter } from "@/lib/mesh-bus";

export default function MeshBackdrop() {
  const pathname = usePathname();
  const [filter, setFilter] = useState<MeshFilter>(meshBus.getFilter());
  useEffect(() => meshBus.onFilter(setFilter), []);
  // The physician workbench paints an opaque muted canvas over the whole
  // viewport, so the mesh would animate for zero visible pixels. Skip it.
  if (pathname.startsWith("/physician")) return null;
  return (
    <HeroMesh
      filter={filter.q}
      semanticIds={filter.ids}
      onMatchCount={meshBus.setMatchCount}
    />
  );
}
