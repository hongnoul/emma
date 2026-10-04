"use client";
// ApexHero: client island for the apex landing page. Owns the live search
// query and feeds it to HeroMesh (background) as a real-time filter while
// rendering the centered hero copy, search bar, and BubbleSelector flows.
//
// Matching is two-tier: HeroMesh does instant local substring matching over
// node names/ids, and a debounced backend api.search unions in semantic hits
// (genes, phenotypes, mechanisms) by their disease ids. Enter hands off to
// /search?q= for the full results page.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import HeroMesh from "@/components/HeroMesh";
import BubbleSelector, { BubbleItem } from "@/components/BubbleSelector";

const SEMANTIC_DEBOUNCE_MS = 300;
const SEMANTIC_MIN_CHARS = 3;

export default function ApexHero({ flows }: { flows: BubbleItem[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [semanticIds, setSemanticIds] = useState<string[] | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0); // drop out-of-order semantic responses

  // Debounced semantic search: union backend hits into the mesh filter.
  useEffect(() => {
    const query = q.trim();
    const seq = ++seqRef.current;
    if (query.length < SEMANTIC_MIN_CHARS) {
      setSemanticIds(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await api.search(query);
        if (seqRef.current !== seq) return; // stale
        setSemanticIds(results.filter((r) => r.type === "Disease").map((r) => r.id));
      } catch {
        // decorative enhancement: local matching still works without it
      }
    }, SEMANTIC_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  // "/" focuses the search bar from anywhere on the page; Escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtering = q.trim().length > 0;

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <HeroMesh filter={q} semanticIds={semanticIds} onMatchCount={setMatchCount} />

      {/* hero copy + search + bubble selector over the mesh */}
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

        {/* search bar: filters the mesh live, Enter opens the full search page */}
        <form
          data-apex-search
          className="mt-10 w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            const query = q.trim();
            router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
          }}
        >
          <div className="flex h-14 items-center gap-3 rounded-full border border-slate-200 bg-white/90 px-5 shadow-[0_4px_16px_rgba(0,0,0,0.12)] backdrop-blur-sm transition focus-within:border-indigo-300 focus-within:shadow-[0_4px_24px_rgba(67,56,202,0.18)]">
            <Search className="size-5 shrink-0 text-slate-400" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); }
              }}
              placeholder="Filter the atlas: disease, gene, phenotype…"
              aria-label="Search the atlas"
              className="h-full w-full bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-400 [&::-webkit-search-cancel-button]:hidden"
            />
            <kbd className="hidden shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] text-slate-400 sm:block">
              /
            </kbd>
          </div>
          {/* live match count keeps the filter honest; fixed height = no layout shift */}
          <p className="mt-2 h-5 text-sm text-muted-foreground" aria-live="polite">
            {filtering && matchCount !== null && (
              matchCount > 0
                ? `${matchCount.toLocaleString()} disease${matchCount === 1 ? "" : "s"} light up — Enter for details`
                : "No diseases match in the atlas"
            )}
          </p>
        </form>

        <div className="mt-8 w-full">
          <BubbleSelector items={flows} />
        </div>
      </section>
    </div>
  );
}
