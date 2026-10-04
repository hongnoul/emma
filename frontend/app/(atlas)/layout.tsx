import Link from "next/link";
import { Cross } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import BottomNav from "@/components/BottomNav";

// Card-shell chrome for every atlas page. The apex landing page (/) opts out
// by living outside this route group.
export default function AtlasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="px-3 pt-3 md:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3 rounded-2xl border bg-background px-4 py-3 shadow-sm">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Cross className="size-4" />
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">Rare Disease Atlas</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-5 text-sm md:flex">
            <Link href="/search" className="text-muted-foreground hover:text-foreground">Search</Link>
            <Link href="/evals" className="text-muted-foreground hover:text-foreground">Evals</Link>
            <Link href="/physician" className="font-medium hover:underline">Physician</Link>
            <Link href="/patient" className="font-medium hover:underline">Patient</Link>
          </nav>
          <Badge variant="outline" className="ml-auto rounded-full bg-muted/50 px-3 py-1 text-muted-foreground">
            <span className="hidden sm:inline">Research prototype · not medical advice</span>
            <span className="sm:hidden">Prototype</span>
          </Badge>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-3 pb-28 pt-4 md:px-6 md:pb-10">
        <div className="rounded-2xl border bg-background p-4 shadow-sm sm:p-8">{children}</div>
      </main>
      <BottomNav />
    </>
  );
}
