// Apex landing page: full-bleed white hero with the atlas UMAP mesh as an
// ambient background and a BubbleMenu as the client-facing flow selector
// (physician / patient / search / graph / evals). The card-shell app lives
// under app/(atlas)/ and keeps its own chrome.
import Link from "next/link";
import { Cross } from "lucide-react";
import HeroMesh from "@/components/HeroMesh";
import BubbleMenu from "@/components/BubbleMenu";

const FLOWS = [
  {
    label: "physician",
    href: "/physician",
    ariaLabel: "Physician workbench",
    rotation: -8,
    hoverStyles: { bgColor: "#3b82f6", textColor: "#ffffff" },
  },
  {
    label: "patient",
    href: "/patient",
    ariaLabel: "Patient companion",
    rotation: 8,
    hoverStyles: { bgColor: "#10b981", textColor: "#ffffff" },
  },
  {
    label: "search",
    href: "/search",
    ariaLabel: "Search the atlas",
    rotation: 8,
    hoverStyles: { bgColor: "#f59e0b", textColor: "#ffffff" },
  },
  {
    label: "graph",
    href: "/graph",
    ariaLabel: "Explore the graph",
    rotation: 8,
    hoverStyles: { bgColor: "#ef4444", textColor: "#ffffff" },
  },
  {
    label: "evals",
    href: "/evals",
    ariaLabel: "Evaluation dashboard",
    rotation: -8,
    hoverStyles: { bgColor: "#8b5cf6", textColor: "#ffffff" },
  },
];

export default function Apex() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <HeroMesh />

      {/* bubble selector: logo bubble + toggle that pops the flow pills */}
      <BubbleMenu
        useFixedPosition
        menuAriaLabel="Choose your flow"
        logo={
          <span className="flex items-center gap-2.5 whitespace-nowrap">
            <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Cross className="size-3.5" />
            </span>
            <span className="font-serif text-base font-semibold tracking-tight text-foreground">
              Rare Disease Atlas
            </span>
          </span>
        }
        items={FLOWS}
      />

      {/* hero copy over the mesh */}
      <section className="pointer-events-none relative z-10 mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Disease · Gene · Variant · Phenotype
        </p>
        <h1 className="mt-5 font-serif text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
          Every rare-disease link,
          <br />
          with its evidence.
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          4,700 diseases positioned by phenotype profile. Every connection shows
          where it came from, and whether it is established or inferred.
        </p>
        <div className="pointer-events-auto mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/physician"
            className="rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-[0_4px_16px_rgba(0,0,0,0.15)] transition hover:scale-[1.04] active:scale-[0.97]"
          >
            I&apos;m a physician
          </Link>
          <Link
            href="/patient"
            className="rounded-full border bg-white px-7 py-3.5 text-sm font-semibold shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition hover:scale-[1.04] hover:bg-muted active:scale-[0.97]"
          >
            I&apos;m a patient
          </Link>
          <Link
            href="/search"
            className="rounded-full border bg-white px-7 py-3.5 text-sm font-semibold shadow-[0_4px_16px_rgba(0,0,0,0.08)] transition hover:scale-[1.04] hover:bg-muted active:scale-[0.97]"
          >
            Search the atlas
          </Link>
        </div>
        <p className="mt-12 text-[11px] text-muted-foreground/70">
          Research prototype · not medical advice
        </p>
      </section>
    </div>
  );
}
