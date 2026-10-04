"use client";
// Landing + search. Layout ported from the Rare Disease Atlas prototype
// (TanStack Start zip): left-aligned editorial hero, large search field,
// example chips. Data stays on the repo FastAPI via lib/api.ts and the
// monochrome shadcn token system.
// Supports deep links: /?q=lysosomal
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, SearchResult } from "@/lib/api";
import AtlasHero from "@/components/AtlasHero";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const EXAMPLES = ["lysosomal", "LYSA1", "seizures", "ciliary", "autophagy"];

function SearchHome() {
  const router = useRouter();
  const initialQ = useSearchParams().get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(query: string) {
    setQ(query); setLoading(true); setError(null);
    router.replace(query ? `/?q=${encodeURIComponent(query)}` : "/");
    try { setResults(await api.search(query)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (initialQ) run(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl py-8">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Disease → gene → variant → phenotype → research
      </p>
      <h1 className="mt-3 text-5xl font-semibold leading-tight">
        Every rare-disease link, with its evidence.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        Connecting rare diseases through biology, evidence, and shared research.
        Each connection shows where it came from, and whether it is established
        or inferred.
      </p>

      <AtlasHero />

      <form
        className="mt-10"
        onSubmit={(e) => { e.preventDefault(); run(q); }}
      >
        <Input
          className="h-12 px-4 text-lg"
          placeholder="Search a disease, gene, phenotype, or mechanism…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading && <p className="mt-2 text-sm text-muted-foreground">Searching the atlas…</p>}
        {error && (
          <p className="mt-2 text-sm font-medium">
            {error} — is the backend running on :8000?
          </p>
        )}
        {results !== null && !loading && !error && (
          results.length > 0 ? (
            <ul className="mt-3 divide-y divide-border rounded-md border bg-card">
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
              No results. The atlas says so rather than guessing.
            </p>
          )
        )}
      </form>

      <div className="mt-10">
        <p className="text-sm text-muted-foreground">Or start with:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => run(ex)}
              className="rounded-full border px-3 py-1 text-sm hover:bg-muted"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-10 text-sm text-muted-foreground">
        Discover connections → Understand the evidence → Find existing
        resources → Identify the next research step
      </p>
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
