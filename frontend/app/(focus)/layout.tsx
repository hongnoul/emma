import AtlasHeader from "@/components/AtlasHeader";
import BottomNav from "@/components/BottomNav";

// Full-bleed chrome for focus pages (/disease/[id]): header and bottom nav
// only, no card container. The persistent mesh backdrop shows through, and
// the page's MeshStage section docks the focused node into the layout.
export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AtlasHeader />
      <main className="pb-28 md:pb-10">{children}</main>
      <BottomNav />
    </>
  );
}
