"use client";
// MeshStage: marks a region of a page as the dock for the mesh's focused
// node. The persistent HeroMesh backdrop anchors the zoomed node to this
// element's live center (tracked per frame, so it follows layout and
// scroll). Mount one per focus page; unmounting releases the anchor back
// to the viewport center.
import { useEffect, useRef } from "react";
import { meshBus } from "@/lib/mesh-bus";

export default function MeshStage({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    meshBus.setStage(ref.current);
    return () => meshBus.setStage(null);
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
