import EmmaticsHeader from "@/components/EmmaticsHeader";
import BottomNav from "@/components/BottomNav";

// Full-bleed chrome for focus pages (/disease/[id]): header and bottom nav
// only, no card container. The persistent mesh backdrop shows through, and
// the page's MeshStage section docks the focused node into the layout.
export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EmmaticsHeader />
      <main className="pb-28 md:pb-10">{children}</main>
      <BottomNav />
    </>
  );
}
