"use client";
// Landing + search. Minimal by design: the next owner replaces this UI.
import { useState } from "react";
import Link from "next/link";
import { api, SearchResult } from "@/lib/api";

const EXAMPLES = ["lysosomal", "LYSA1", "seizures", "ciliary", "autophagy"];

export default function Home() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(query: string) {
    setQ(query); setLoading(true); setError(null);
    try { setResults(await api.search(query)); }
    catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-8">
      <header className="text-center space-y-2 pt-8">
        <h1 className="text-3xl font-semibold">Rare Disease Atlas</h1>
        <p className="text-slate-600">Connecting rare diseases through biology, evidence, and shared research.</p>
      </header>

      <form className="max-w-xl mx-auto" onSubmit={(e) => { e.preventDefault(); run(q); }}>
        <input
          className="w-full border border-slate-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search a disease, gene, phenotype, or mechanism..."
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-2 mt-2 flex-wrap justify-center text-sm">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => run(ex)}
              className="text-blue-700 hover:underline">{ex}</button>
          ))}
        </div>
      </form>

      <p className="text-center text-sm text-slate-500">
        Discover connections → Understand the evidence → Find existing resources → Identify the next research step
      </p>

      {loading && <p className="text-center text-slate-500">Searching…</p>}
      {error && <p className="text-center text-red-600 text-sm">{error} — is the backend running on :8000?</p>}
      {results !== null && !loading && (
        <ul className="max-w-xl mx-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {results.length === 0 && <li className="p-4 text-slate-500 text-sm">No results. The atlas says so rather than guessing.</li>}
          {results.map((r) => (
            <li key={r.id} className="p-4">
              {r.type === "Disease" ? (
                <Link href={`/disease/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link>
              ) : (
                <span className="font-medium">{r.name}</span>
              )}
              <span className="ml-2 text-xs rounded bg-slate-100 px-1.5 py-0.5">{r.type}</span>
              <span className="ml-2 text-xs text-slate-400">{r.identifier}</span>
              <p className="text-sm text-slate-600 mt-1">{r.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
