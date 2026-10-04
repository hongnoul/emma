import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rare Disease Atlas · Physician",
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
      <div className="border-b bg-background px-6 py-2 flex items-center gap-5 text-sm">
        <span className="font-semibold">Physician partition</span>
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="text-muted-foreground hover:text-foreground">
            {t.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          calibrated judgments · never presented as facts
        </span>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
    </div>
  );
}
