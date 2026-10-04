import EmmaticsHeader from "@/components/EmmaticsHeader";
import BottomNav from "@/components/BottomNav";

// Card-shell chrome for every atlas page. The apex landing page (/) opts out
// by living outside this route group, and /disease/[id] lives in (focus)
// with full-bleed chrome so the persistent mesh shows through.
export default function EmmaticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <EmmaticsHeader />
      <main className="mx-auto max-w-5xl px-3 pb-28 pt-4 md:px-6 md:pb-10">
        <div className="rounded-2xl border bg-background p-4 shadow-sm sm:p-8">{children}</div>
      </main>
      <BottomNav />
    </>
  );
}
