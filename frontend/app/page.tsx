// Apex landing page: full-bleed white hero with the atlas UMAP mesh as an
// ambient background, a centered search bar that filters the mesh in real
// time, and bubble buttons as the client-facing flow selector
// (physician / patient / explorer). The card-shell app lives under
// app/(atlas)/ and keeps its own chrome. All interactivity lives in the
// ApexHero client island.
import ApexHero from "@/components/ApexHero";

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
    sub: "search Emmatics",
    href: "/search",
    ariaLabel: "Search Emmatics",
    rotation: 8,
    hoverStyles: { bgColor: "#8b5cf6", textColor: "#ffffff" },
  },
];

export default function Apex() {
  return <ApexHero flows={FLOWS} />;
}
