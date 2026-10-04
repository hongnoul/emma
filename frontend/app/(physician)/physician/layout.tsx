import Link from "next/link";
import type { Metadata } from "next";
import PhysicianTabs from "@/components/PhysicianTabs";

export const metadata: Metadata = {
  title: "Emmatics · Physician",
  description: "Evidence interrogation workbench: triage judged edges, ablate evidence, tighten inference paths.",
};

// Physician lives in its own route group so it owns its chrome outright:
// one top bar (brand + tabs), a flat muted canvas, no card-in-card nesting
// and no negative-margin escape from the (emmatics) shell. The canvas uses
// .physician-canvas (globals.css): it fades in from transparent over the
// lingering mesh backdrop on the apex handoff (see MeshBackdrop).
export default function PhysicianLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="physician-canvas min-h-screen">
      <div className="sticky top-0 z-40 border-b bg-background">
        <div className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto whitespace-nowrap px-4 py-2.5 text-sm md:gap-5 md:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2" title="Back to Emmatics">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="" className="size-6" />
            <span className="font-semibold">Physician</span>
          </Link>
          <PhysicianTabs />
          <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
            calibrated judgments · never presented as facts
          </span>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
    </div>
  );
}
