"use client";
// Paper reader. Faithful port of the atlas prototype's paper.$pmid route:
// PMID header with external links, open-access full text section by section
// from PMC BioC, graceful fallback when the paper is not open access.
// Data via the repo FastAPI proxy (api.paper); monochrome shadcn tokens.
import { use, useEffect, useState } from "react";
import { api, PaperDetail } from "@/lib/api";

export default function PaperPage({ params }: { params: Promise<{ pmid: string }> }) {
  const { pmid } = use(params);
  const [data, setData] = useState<PaperDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.paper(pmid).then(setData).catch((e) => setError(String(e)));
  }, [pmid]);

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!data)
    return (
      <p className="py-8 font-mono text-sm text-muted-foreground">Fetching paper…</p>
    );
  if (!data.paper)
    return <p className="py-8 text-sm text-muted-foreground">Paper not found.</p>;

  const { paper, fullText } = data;

  return (
    <div className="mx-auto max-w-3xl py-2">
      <p className="font-mono text-xs text-muted-foreground">
        PMID {paper.pmid}
        {paper.pmcid && ` · ${paper.pmcid}`}
        {fullText?.license && ` · ${fullText.license}`}
      </p>
      <h1 className="mt-2 text-3xl font-semibold leading-tight">
        {fullText?.title || paper.title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {paper.authors.join(", ")} · {paper.journal} · {paper.date}
      </p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <a
          className="underline underline-offset-4 hover:no-underline"
          href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
          target="_blank"
          rel="noreferrer"
        >
          PubMed ↗
        </a>
        {paper.pmcid && (
          <a
            className="underline underline-offset-4 hover:no-underline"
            href={`https://pmc.ncbi.nlm.nih.gov/articles/${paper.pmcid}/`}
            target="_blank"
            rel="noreferrer"
          >
            PubMed Central ↗
          </a>
        )}
        {paper.doi && (
          <a
            className="underline underline-offset-4 hover:no-underline"
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noreferrer"
          >
            Publisher ↗
          </a>
        )}
      </div>

      {!fullText && (
        <p className="mt-8 rounded border bg-card p-4 text-sm text-muted-foreground">
          {data.error
            ? `Full text couldn't be loaded: ${data.error}`
            : "This paper isn't in the open-access collection, so only the links above are available."}
        </p>
      )}
      {fullText && (
        <article className="mt-8 space-y-6">
          {fullText.sections.map((s, i) => (
            <section key={i}>
              {s.heading && <h2 className="mb-2 text-xl font-semibold">{s.heading}</h2>}
              {s.paragraphs.map((p, j) => (
                <p key={j} className="mb-3 leading-relaxed">{p}</p>
              ))}
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
