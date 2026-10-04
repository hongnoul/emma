"use client";
// Landing + search, Rarepath-style layout: step badge, serif editorial
// headline, stacked pill CTAs, card sections. Data stays on the repo
// FastAPI via lib/api.ts and the monochrome shadcn token system.
// Supports deep links: /search?q=lysosomal
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, SearchResult } from "@/lib/api";
import EmmaticsHero from "@/components/EmmaticsHero";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLES = ["lysosomal", "LYSA1", "seizures", "ciliary", "autophagy"];

function SearchHome() {
  const router = useRouter();
  const initialQ = useSearchParams().get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function run(query: string) {
    setQ(query); setLoading(true); setError(null);
    router.replace(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
    try { setResults(await api.search(query)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (initialQ) run(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* hero card */}
      <section className="space-y-5 py-2 sm:py-4">
        <Badge variant="outline" className="rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Disease · Gene · Variant · Phenotype
        </Badge>
        <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl">
          Every rare-disease link, with its evidence.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Emmatics matches diseases through biology, evidence, and shared
          research — each connection shows where it came from, and whether it
          is established or inferred.
        </p>
        <div className="flex flex-col gap-3 pt-1">
          <Button size="lg" className="h-13 w-full rounded-full text-base font-semibold"
            onClick={() => searchRef.current?.focus()}>
            Search Emmatics
          </Button>
          <Button asChild size="lg" variant="outline" className="h-13 w-full rounded-full text-base">
            <Link href="/physician">Open the physician workbench</Link>
          </Button>
        </div>
      </section>

      <EmmaticsHero />

      {/* search card */}
      <section className="rounded-2xl border bg-muted/30 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">Search</h2>
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); run(q); }}>
          <Input
            ref={searchRef}
            className="h-12 rounded-xl bg-background px-4 text-base"
            placeholder="Disease, gene, phenotype, or mechanism…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {loading && <p className="mt-2 text-sm text-muted-foreground">Searching Emmatics…</p>}
          {error && (
            <p className="mt-2 text-sm font-medium">
              {error} — is the backend running on :8000?
            </p>
          )}
          {results !== null && !loading && !error && (
            results.length > 0 ? (
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border bg-background">
                {results.map((r) => (
                  <li key={r.id}>
                    {r.type === "Disease" ? (
                      <Link href={`/disease/${r.id}`} className="block px-4 py-3 hover:bg-muted">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="font-medium">{r.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">{r.identifier ?? r.id}</span>
                        </div>
                        {r.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
                        )}
                      </Link>
                    ) : (
                      <div className="block px-4 py-3">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="font-medium">
                            {r.name}
                            <Badge variant="secondary" className="ml-2">{r.type}</Badge>
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">{r.identifier ?? r.id}</span>
                        </div>
                        {r.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No results. Emmatics says so rather than guessing.
              </p>
            )
          )}
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => run(ex)}
              className="rounded-full border bg-background px-3.5 py-1.5 text-sm hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </div>
      </section>

      {/* journey card */}
      <section className="rounded-2xl border bg-muted/30 p-4 sm:p-6">
        <h2 className="text-xl font-semibold">How Emmatics works</h2>
        <ol className="mt-4 space-y-0">
          {[
            ["Discover connections", "Search links a disease to genes, variants, phenotypes, and related diseases."],
            ["Understand the evidence", "Every edge carries provenance and a calibrated p(valid), never a bare claim."],
            ["Find existing resources", "Publications, studies, researchers, and patient organizations on each page."],
            ["Identify the next research step", "Derived opportunities state what exists, what is missing, and what to validate."],
          ].map(([title, body], i, arr) => (
            <li key={title} className="relative flex gap-4 pb-6 last:pb-0">
              {i < arr.length - 1 && (
                <span className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-border" aria-hidden />
              )}
              <span className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <div className="pt-1">
                <p className="font-semibold leading-tight">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function Home() {
  // useSearchParams requires a Suspense boundary for static prerender.
  return (
    <Suspense>
      <SearchHome />
    </Suspense>
  );
}
