# Continuous Ingestion Pipeline — Production Design

Status: design (phase 1 is the current build target).
Consumers: backend API, future MCP server. The judged-edge schema
(`backend/app/models/schemas.py`) is the only contract downstream of this
pipeline; nothing after the publisher knows source formats.

## Principles

1. **The judged-edge schema is the only contract.** Frontend/API/MCP consume
   Node/Edge with decision blocks.
2. **Raw is immortal, derived is disposable.** Every stage re-runs from the
   stage before it; only raw/ is irreplaceable.
3. **Nothing reaches users without the gate.** Trap suite + calibration
   regression are deploy blockers, same as tests in code CI.
4. **Everything versioned and attributable**: source release, pipeline run,
   judge checkpoint, question pack.

## Topology

```
            ┌────────────── scheduler (per-source cadence) ─────────────┐
            ▼               ▼               ▼                ▼
        [fetchers]      (PubMed      (ClinVar          (MONDO/HPO
         nightly)        nightly)     weekly)           monthly, pinned)
            │ raw + manifest {source, version, fetched_at, checksum}
            ▼
        object store    atlas-raw/{source}/{version}/...
            ▼
        [normalizers]   per-source → staging (source-local IDs)
            ▼
        [reconciler]    MONDO/HGNC/HPO xref spine → canonical IDs
            │           merge log + human conflict queue
            ▼
        [snippet assembler]  builds `state` per judgeable edge (≤512 tok, content-hashed)
            ▼
        [judge farm]    Laya batch; decision blocks + decision_meta
            ▼
        [gate]          traps · ECE regression · volume sanity · schema · ref integrity
            │ pass                          │ fail
            ▼                               ▼
        [publisher]     atomic generation swap    hold + page curator,
                                                  keep serving last-good
            ▼
        [diff reporter] → curator queue, alerts, metrics
```

## Stage specs

### Scheduler
Temporal/Prefect (durable, retries, backfills); cron acceptable for v0.
Per-source cadence: PubMed + ClinicalTrials.gov nightly; ClinVar + NIH
RePORTER weekly; MONDO/HPO/Orphanet monthly and **version-pinned** (ontology
upgrades are deliberate, never automatic).

### Fetchers
One container per source, interface `fetch(since) -> raw files + manifest`.
API keys from secret store (NCBI key; OMIM only if licensed — note MONDO +
Orphanet + ClinVar cover most of OMIM without the licensing friction).
Rate-limit compliance with backoff; resumable; delta fetch where supported
(PubMed EDAT ranges, CT.gov lastUpdatePostedDate), snapshot where not
(ClinVar weekly file). Raw lands immutable with checksums.

### Normalizers
Pure functions raw -> staging rows carrying
`(source, source_record_id, source_version)` — the idempotency key.
Unit-tested against frozen fixtures per source; a source format change
breaks a fixture test in CI, not production.

### Reconciler (the hard stage)
MONDO xrefs = disease spine; HGNC = genes; HPO native = phenotypes.
Deterministic xref joins auto-merge. Ambiguous cases go to a human
**conflict queue**, never guessed. Merge log allows unwinding any merge.

### Snippet assembler
Per judgeable edge, compose `state`: claim sentence (names, not IDs) +
evidence excerpts with [source, year] attribution + known contradicting
excerpts. Token budget enforced; truncate the evidence list, never
mid-excerpt. `state_hash` (content hash): unchanged -> skip re-judge.
This is the main cost saver.

### Judge farm
Batch worker over edges where state_hash changed or judge/pack version
bumped. Laya batch endpoint; one spot T4 (~8.5k judgments/min batched) or
CPU. decision_meta records {model, model_revision, question_pack,
temperature_version, judged_at, state_hash}. Full re-judge of 1M edges ≈ 2
GPU-hours — affordable on every judge version bump.

### Gate (deploy blockers)
- Trap suite: zero expert-authored refuted claims above publish threshold.
- Calibration: ECE on gold set within ±0.02 of last release; Brier not
  degraded >10%.
- Volume sanity: node/edge counts in expected bands per source (catches
  silent fetcher truncation).
- Schema validation (Pydantic) + referential integrity (no orphan edges).

### Publisher
Immutable graph generations. Swap = flip one pointer; rollback = flip back.
API serves exactly one consistent generation at all times.

### Diff reporter
Per publish: created/retired edges; |Δ p(valid)| > 0.15; newly contradicted
(contradicted crossed 0.5); merges/splits. Feeds curator queue (ranked by
Δ × degree centrality), metrics, optional user alerts ("new evidence in
your cluster").

## Schema additions

```
edges += source_version, ingested_at, state_hash, generation_introduced
nodes += xrefs {mondo, omim, orphanet, hgnc, ...}, merged_from[]
new: generations(id, created_at, gate_report, judge_version, status)
new: conflict_queue(entity_pair, reason, resolver, resolved_at)
new: overrides(edge_id, expert, verdict, rationale, ts) -> appends to gold set
```

## Failure handling

| Failure | Behavior |
|---|---|
| Source API down | retry/backoff; skip source this run; staleness metric; publish with fresh sources only |
| Source format change | fixture test fails in CI; raw cached; patch normalizer, re-run from raw |
| Gate fails | serve last-good; page curator with gate report; never partial-publish |
| Judge regression | ECE gate catches; pin previous checkpoint |
| Bad reconciler merge | merge log unwind; re-judge affected edges |

## Ops

Containerized; pipeline defs in repo; staging runs the full DAG on fixtures
in CI per PR. SLOs: PubMed-to-published ≤ 48h; gate < 10 min; rollback < 1
min. Cost: fetch/normalize pennies (CPU); judging one spot T4 a few
hours/night; storage dominated by raw PubMed cache.

## Build order (each phase ships something demoable)

1. **Vertical slice**: MONDO+HPO+ClinVar+PubMed fetchers → normalizers →
   reconciler for one lysosomal cluster; manual trigger; replaces mock nodes
   with real ones. *(hackathon slice)*
2. **Continuity**: scheduler + delta fetch + state-hash skip + nightly cron +
   diff report.
3. **Safety**: gate as publish blocker; generations + atomic swap + rollback;
   curator queue UI.
4. **Scale-out**: CT.gov, RePORTER, Orphanet; conflict-queue tooling;
   observability.
5. **Closed loop**: overrides → gold-set growth → scheduled recalibration →
   (at label volume) LoRA fine-tune gated by the same acceptance checks.
```
