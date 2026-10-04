"use client";
// Basic research page. Faithful port of the atlas prototype's
// research.$mondoId route: PubMed lab/animal-model studies with
// organism/model filter chips, per-paper classification evidence, and
// links to the full-text reader. Data via the repo FastAPI proxy
// (api.research); monochrome shadcn tokens throughout.
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, BasicResearch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<BasicResearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    api.research(id).then(setData).catch((e) => setError(String(e)));
  }, [id]);

  if (error) return <p className="text-sm font-medium">{error}</p>;
  if (!data)
    return (
      <p className="py-8 font-mono text-sm text-muted-foreground">
        Searching PubMed for lab and animal-model studies…
      </p>
    );

  const papers = model
    ? data.papers.filter((p) => p.models.includes(model))
    : data.papers;

  return (
    <div className="mx-auto max-w-5xl py-2">
      <Link href={`/disease/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← {data.disease.label}
      </Link>
      <h1 className="mt-2 text-4xl font-semibold">Basic research</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Experimental studies and reviews on {data.disease.label}.{" "}
        {data.total.toLocaleString()} PubMed matches; showing {data.papers.length} most relevant.
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">inferred</Badge>
        Organism and model mentions are not confirmation of experimental use.
        Reviews are labelled separately.
      </div>
      {data.error && (
        <p className="mt-4 text-sm font-medium">PubMed is unavailable right now: {data.error}</p>
      )}
      {data.classificationError && (
        <p className="mt-4 text-sm font-medium">
          Abstracts and article types could not be loaded; labels use titles only.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={model === null}
          onClick={() => setModel(null)}
          className={model == null ? "border-foreground" : ""}
        >
          All · {data.papers.length}
        </Button>
        {Object.entries(data.counts)
          .sort((a, b) => b[1] - a[1])
          .map(([m, c]) => (
            <Button
              key={m}
              size="sm"
              variant="outline"
              aria-pressed={model === m}
              onClick={() => setModel(m)}
              className={model === m ? "border-foreground" : ""}
            >
              {m} · {c}
            </Button>
          ))}
      </div>

      <ul className="mt-6 space-y-4">
        {papers.map((p) => (
          <li key={p.pmid} className="border-t pt-4 text-sm">
            <Link
              href={`/paper/${p.pmid}`}
              className="font-medium underline-offset-4 hover:underline"
            >
              {p.title}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {p.authors.join(", ")} · {p.journal} · {p.date}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {p.models.map((m) => (
                <span key={m} className="rounded-sm bg-muted px-1.5">{m}</span>
              ))}
              {p.pmcid && (
                <span className="rounded-sm border px-1.5 font-medium">free full text</span>
              )}
            </div>
            {p.classification.length > 0 && (
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer font-medium">
                  Classification evidence
                </summary>
                <dl className="mt-2 space-y-2">
                  {p.classification.map((item) => (
                    <div key={item.label}>
                      <dt className="font-medium">{item.label} · {item.source}</dt>
                      <dd className="mt-0.5 leading-relaxed">{item.snippet}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </li>
        ))}
        {papers.length === 0 && (
          <li className="border-t pt-4 text-sm text-muted-foreground">
            No studies match this filter.
          </li>
        )}
      </ul>
    </div>
  );
}
