// Apex landing page: full-bleed white hero with the atlas UMAP mesh as an
// ambient background and bubble buttons as the client-facing flow selector
// (physician / patient / explorer). The card-shell app lives under
// app/(atlas)/ and keeps its own chrome.
import HeroMesh from "@/components/HeroMesh";
import BubbleSelector from "@/components/BubbleSelector";

const FLOWS = [
  {
    label: "Physician",
    sub: "triage & evidence",
    href: "/physician",
    ariaLabel: "Physician workbench",
    rotation: -6,
    hoverStyles: { bgColor: "#3b82f6", textColor: "#ffffff" },
  },
  {
    label: "Patient",
    sub: "companion & community",
    href: "/patient",
    ariaLabel: "Patient companion",
    rotation: 4,
    hoverStyles: { bgColor: "#10b981", textColor: "#ffffff" },
  },
  {
    label: "Explorer",
    sub: "search the atlas",
    href: "/search",
    ariaLabel: "Search the atlas",
    rotation: 8,
    hoverStyles: { bgColor: "#8b5cf6", textColor: "#ffffff" },
  },
];

export default function Apex() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <HeroMesh />

      {/* hero copy + bubble selector over the mesh */}
      <section className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-text.svg"
            alt="Emmatics"
            className="h-48 w-auto sm:h-64"
          />
        </h1>
        <p className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          4,700 diseases positioned by phenotype profile. Every connection shows
          where it came from, and whether it is established or inferred.
        </p>

        <div className="mt-12 w-full">
          <BubbleSelector items={FLOWS} />
        </div>
      </section>
    </div>
  );
}
