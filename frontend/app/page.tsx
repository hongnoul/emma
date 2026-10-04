"use client";
// Landing + search. Minimal by design: the next owner replaces this UI.
// Supports deep links: /?q=lysosomal
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, SearchResult } from "@/lib/api";
import AtlasHero from "@/components/AtlasHero";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-8">
      <header className="text-center space-y-2 pt-8">
        <h1 className="text-3xl font-semibold">Rare Disease Atlas</h1>
        <p className="text-muted-foreground">Connecting rare diseases through biology, evidence, and shared research.</p>
      </header>

      <AtlasHero />

      <form className="max-w-xl mx-auto" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <Input
          className="h-12 px-4"
          placeholder="Search a disease, gene, phenotype, or mechanism..."
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-1 mt-2 flex-wrap justify-center">
          {EXAMPLES.map((ex) => (
            <Button key={ex} type="button" variant="link" size="sm" onClick={() => run(ex)}>
              {ex}
            </Button>
          ))}
        </div>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Discover connections → Understand the evidence → Find existing resources → Identify the next research step
      </p>

      {loading && <p className="text-center text-muted-foreground">Searching…</p>}
      {error && <p className="text-center text-sm font-medium">{error} — is the backend running on :8000?</p>}
      {results !== null && !loading && (
        <ul className="max-w-xl mx-auto divide-y rounded-lg border">
          {results.length === 0 && <li className="p-4 text-muted-foreground text-sm">No results. The atlas says so rather than guessing.</li>}
          {results.map((r) => (
            <li key={r.id} className="p-4">
              {r.type === "Disease" ? (
                <Link href={`/disease/${r.id}`} className="font-medium underline underline-offset-4 hover:no-underline">{r.name}</Link>
              ) : (
                <span className="font-medium">{r.name}</span>
              )}
              <Badge variant="secondary" className="ml-2">{r.type}</Badge>
              <span className="ml-2 text-xs text-muted-foreground">{r.identifier}</span>
              <p className="text-sm text-muted-foreground mt-1">{r.description}</p>
            </li>
          ))}
        </ul>
      )}
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
