import Link from "next/link";
import { Badge } from "@/components/ui/badge";

// Floating pill header shared by the card-shell (emmatics) and full-bleed
// (focus) route groups.
export default function EmmaticsHeader() {
  return (
    <header className="px-3 pt-3 md:px-6">
      <div className="mx-auto flex max-w-5xl items-center gap-3 rounded-2xl border bg-background px-4 py-3 shadow-sm">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Emmatics" className="size-9" />
          <span className="font-serif text-lg font-semibold tracking-tight">Emmatics</span>
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
  );
}
