"use client";
// Physician partition home: the UMAP hero ("map of rare disease space") is
// the entry point — judged links colored by band, click-through into triage.
// If the hero artifact is missing we fall back to the static header + band
// cards (zero regression).
//
// Below the hero, one search-first node section works at any generation size:
// with no query, /v1/attention ranks nodes by judged review-band edges (exact,
// computed server-side in one O(edges) pass); typing searches /v1/entities
// with the same resolution the rest of the app uses (name > synonym >
// description). Nothing fetches the whole graph, so the bulk generation
// (17k nodes / 84k edges) behaves exactly like the demo one.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { v1, Meta, EdgesResponse, AttentionItem, EntityHit } from "@/lib/v1";
import EmmaticsHero from "@/components/EmmaticsHero";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// Display order: clinical entities first, literature/infrastructure last.
const TYPE_ORDER = [
  "Disease", "Gene", "Variant", "Phenotype", "Mechanism", "Pathway",
  "ClinicalTrial", "Publication", "Researcher", "PatientOrganization", "ResearchAsset",
];

type Row = {
  id: string; name: string; type: string; description: string;
  degree?: number; review?: number; match?: string;
};

export default function PhysicianHome() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [bands, setBands] = useState<{ established: number; review: number; hidden: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [heroFailed, setHeroFailed] = useState(false);

  useEffect(() => {
    v1.meta().then(setMeta).catch((e) => setError(String(e)));
    Promise.all([
      v1.edges({ judged_only: true, min_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, min_valid: 0.4, max_valid: 0.9, limit: 1 }),
      v1.edges({ judged_only: true, max_valid: 0.4, limit: 1 }),
    ]).then(([a, r, l]: EdgesResponse[]) =>
      setBands({ established: a.total, review: r.total, hidden: l.total })
    ).catch(() => { /* non-fatal */ });
  }, []);

  if (error) return <p className="text-sm font-medium">{error}</p>;

  const judgeLive = meta?.judge && meta.judge !== "none";

  return (
    <div className="space-y-6">
      {!heroFailed && <EmmaticsHero onFailed={() => setHeroFailed(true)} />}

      <header className="space-y-2">
        {heroFailed && (
          <h1 className="text-2xl font-semibold">Evidence interrogation workbench</h1>
        )}
        <p className="text-sm text-muted-foreground max-w-2xl">
          Search any entity in the judged graph, or work the attention list:
          nodes ranked by how many of their connections still need a verdict.
        </p>
        {meta && (
          <p className="text-xs text-muted-foreground">
            generation <span className="font-mono">{meta.generation_id}</span> ·{" "}
            {meta.nodes.toLocaleString()} nodes · {meta.edges.toLocaleString()} edges ·{" "}
            judge:{" "}
            <span className={judgeLive ? "font-medium text-foreground" : ""}>
              {judgeLive ? `${meta.judge} (live)` : "offline — stored judgments only"}
            </span>
          </p>
        )}
      </header>

      {heroFailed && bands && (
        <section className="grid max-w-2xl grid-cols-3 gap-2 sm:gap-4">
          {([
            ["established ≥ 0.90", bands.established, "bg-primary text-primary-foreground", "/physician/triage?lo=0.9&hi=1"],
            ["review 0.40–0.90", bands.review, "bg-secondary text-secondary-foreground border", "/physician/triage"],
            ["hidden < 0.40", bands.hidden, "border border-dashed text-muted-foreground", "/physician/triage?lo=0&hi=0.4"],
          ] as const).map(([label, n, cls, href]) => (
            <Link key={label} href={href}
              className={`rounded-lg p-3 text-center transition hover:shadow-sm ${cls}`}>
              <p className="text-xl font-semibold">{n.toLocaleString()}</p>
              <p className="text-xs">{label}</p>
              <p className="mt-1 text-[10px] opacity-70">triage →</p>
            </Link>
          ))}
        </section>
      )}

      {meta && <NodeSection meta={meta} />}

      <p className="text-xs text-muted-foreground max-w-2xl">
        Decision semantics: p(valid) is a calibrated probability, not a fact claim.
        Check <Link className="underline underline-offset-4 hover:no-underline" href="/evals">the calibration report</Link> before
        gating clinical workflows on any threshold.
      </p>
    </div>
  );
}

/* ------------- search-first node section: /v1/attention + /v1/entities ---- */

function NodeSection({ meta }: { meta: Meta }) {
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  const [hits, setHits] = useState<EntityHit[] | null>(null);
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<string>("all");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const typesParam = activeType === "all" ? "" : activeType;

  // Default view: the attention worklist for the current type filter.
  useEffect(() => {
    setAttention(null);
    v1.attention({ types: typesParam, limit: 100 })
      .then((r) => setAttention(r.items))
      .catch((e) => setError(String(e)));
  }, [typesParam]);

  // Search view: debounced server-side entity resolution.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setHits(null); setSearching(false); return; }
    setSearching(true);
    const id = ++seq.current;
    const t = setTimeout(() => {
      v1.entities(q, typesParam, 50)
        .then((r) => { if (seq.current === id) { setHits(r.items); setSearching(false); } })
        .catch((e) => { if (seq.current === id) { setError(String(e)); setSearching(false); } });
    }, 250);
    return () => clearTimeout(t);
  }, [query, typesParam]);

  const searchMode = query.trim().length >= 2;

  const rows: Row[] | null = useMemo(() => {
    if (searchMode) {
      return hits?.map((h) => ({
        id: h.node.id, name: h.node.name, type: h.node.type,
        description: h.node.description,
        degree: Object.values(h.connections ?? {}).reduce((s, n) => s + n, 0),
        match: h.match,
      })) ?? null;
    }
    return attention?.map((a) => ({
      id: a.node.id, name: a.node.name, type: a.node.type,
      description: a.node.description, degree: a.degree, review: a.review,
    })) ?? null;
  }, [searchMode, hits, attention]);

  if (error) return <p className="text-sm font-medium">{error}</p>;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {searchMode ? "Search results" : "Needs attention"}
          {rows && <span className="ml-2 text-sm font-normal text-muted-foreground">{rows.length}</span>}
        </h2>
        <Input
          className="h-9 w-full max-w-xs"
          placeholder="Search diseases, genes, phenotypes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <TypePill label="all" active={activeType === "all"} onClick={() => setActiveType("all")} />
        {TYPE_ORDER.filter((t) => (meta.node_types?.[t] ?? 0) > 0).map((t) => (
          <TypePill key={t} label={`${t} (${meta.node_types[t].toLocaleString()})`} active={activeType === t}
            onClick={() => setActiveType(activeType === t ? "all" : t)} />
        ))}
      </div>

      {!rows || searching ? (
        <p className="text-sm text-muted-foreground">{searching ? "Searching…" : "Loading…"}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {searchMode ? "No entities match." : "No judged edges need review in this view."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border bg-background">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/physician/triage?node=${encodeURIComponent(r.id)}${searchMode ? "&lo=0&hi=1" : ""}`}
                className="block px-4 py-2.5 transition hover:bg-muted"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {r.name}
                    <Badge variant="secondary" className="ml-2 align-middle text-[10px]">{r.type}</Badge>
                    {r.match && r.match !== "name" && (
                      <span className="ml-2 text-[10px] text-muted-foreground">matched {r.match}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {r.degree != null ? `${r.degree} edge${r.degree === 1 ? "" : "s"}` : "–"}
                    {r.review != null && r.review > 0 && (
                      <span className="ml-2 rounded border px-1.5 py-0.5 text-[10px] text-foreground">
                        triage {r.review} →
                      </span>
                    )}
                  </span>
                </div>
                {r.description && (
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TypePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? "bg-primary text-primary-foreground border-primary"
               : "bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
