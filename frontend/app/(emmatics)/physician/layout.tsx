import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Emmatics · Physician",
  description: "Evidence interrogation workbench: triage judged edges, ablate evidence, tighten inference paths.",
};

const TABS = [
  { href: "/physician", label: "Overview" },
  { href: "/physician/triage", label: "Triage queue" },
  { href: "/physician/paths", label: "Path inspector" },
];

export default function PhysicianLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="-m-4 min-h-screen overflow-hidden rounded-2xl bg-muted/40 sm:-m-8">
      <div className="flex items-center gap-4 overflow-x-auto whitespace-nowrap border-b bg-background px-4 py-2.5 text-sm md:gap-5 md:px-6">
        <span className="font-semibold">Physician partition</span>
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="text-muted-foreground hover:text-foreground">
            {t.label}
          </Link>
        ))}
        <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">
          calibrated judgments · never presented as facts
        </span>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</div>
    </div>
  );
}
