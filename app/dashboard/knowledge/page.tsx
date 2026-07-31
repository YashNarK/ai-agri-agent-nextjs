// ============================================================
// app/dashboard/knowledge/page.tsx
//
// Hybrid search over the agronomic knowledge base: vector similarity
// and full-text search, fused (services/search.service.ts).
//
// Unlike every other dashboard page, this one depends on an EXTERNAL
// service: the query is embedded by Azure OpenAI before pgvector can
// rank anything. In hybrid mode that is survivable — the lexical half
// still runs, and the page says so — so the hard failure card below is
// now reached only in the explicit `semantic` mode.
//
// Each result carries WHY it is here (meaning, wording, or both),
// because with two retrievers the ordering is no longer explained by
// one number.
//
// The query lives in the URL, which keeps a search linkable and lets
// the whole page stay a Server Component.
// ============================================================

import { Suspense } from "react";

import { SimilarityBar } from "@/components/charts/similarity-bar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchBadge } from "@/components/match-badge";
import { requireApproved } from "@/lib/auth/guard";
import { getCrops, searchKnowledge } from "@/lib/api";
import { searchModeSchema, type SearchMode } from "@/lib/schemas";

import { SearchForm } from "./search-form";

export const metadata = { title: "Knowledge" };
export const dynamic = "force-dynamic";

async function Results({
  query,
  cropCode,
  mode,
}: {
  query: string;
  cropCode?: string;
  mode: SearchMode;
}) {
  let outcome;
  try {
    outcome = await searchKnowledge(query, cropCode ?? null, 8, mode);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-base">Search is unavailable</CardTitle>
          <CardDescription>
            The query could not be embedded, so nothing could be ranked. The
            knowledge base itself is fine — this is a failure somewhere in
            config resolution or the embedding call. The underlying error is
            shown verbatim below rather than being guessed at.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            {detail}
          </pre>
          {/* The commonest cause locally, and cheap to rule out: this
              path needs Secrets Manager, whereas the database does not
              when DATABASE_URL is set. */}
          <p className="text-xs text-muted-foreground">
            If this reads as a credentials problem, note that search resolves
            its keys from AWS Secrets Manager. Database pages keep working
            without AWS because <code>DATABASE_URL</code> short-circuits that
            lookup — so the rest of the dashboard being healthy does not mean
            credentials are configured.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { results, degraded } = outcome;

  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No articles matched “{query}”.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* A fallback that is not announced is indistinguishable from the
          knowledge base having got worse. */}
      {degraded && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              Keyword matches only — the semantic half is down
            </CardTitle>
            <CardDescription>
              The query could not be embedded, so these are ranked by wording
              alone. Articles that answer the question in different words are
              missing from this list. The underlying error was:{" "}
              <span className="font-mono">{degraded.reason}</span>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        {results.length} articles, {RANKING_NOTE[outcome.mode]}.
      </p>

      {results.map((result) => (
        <Card key={result.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-base">{result.title}</CardTitle>
              <div className="flex items-center gap-2">
                <MatchBadge matchedBy={result.matched_by} />
                {result.category && (
                  <Badge variant="secondary">{result.category}</Badge>
                )}
              </div>
            </div>
            <CardDescription>
              {result.source ?? "Unknown source"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Null only in keyword mode: no query vector, so no
                distance was measured. A 0.00 bar would be a claim, and
                the wrong one. */}
            {result.similarity !== null && (
              <SimilarityBar value={result.similarity} />
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {result.content.slice(0, 400)}
              {result.content.length > 400 ? "…" : ""}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const RANKING_NOTE: Record<SearchMode, string> = {
  hybrid: "ranked by rank fusion across both retrievers",
  semantic: "ranked by cosine similarity",
  keyword: "ranked by full-text relevance",
};

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; crop?: string; mode?: string }>;
}) {
  // Before anything is read: this page embeds the query through Azure
  // OpenAI. proxy.ts already redirects visitors with no session cookie,
  // but that check is optimistic and never sees approval status.
  await requireApproved("/dashboard/knowledge");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const crops = await getCrops();

  // The URL is user-editable, so the mode is parsed rather than cast —
  // an unknown value falls back to the default instead of reaching the
  // service as a string it does not handle.
  const mode: SearchMode = searchModeSchema.catch("hybrid").parse(params.mode);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Agronomic knowledge
        </h1>
        <p className="text-sm text-muted-foreground">
          Hybrid search over the knowledge base. Ask in plain language and it
          matches on meaning; name an exact term — a pathogen, a fertiliser
          ratio — and it matches that too.
        </p>
      </header>

      <SearchForm
        crops={crops.crops.map((c) => ({ code: c.code, name: c.name }))}
        query={query}
        cropCode={params.crop ?? ""}
        mode={mode}
      />

      {query ? (
        <Suspense
          key={`${query}-${params.crop ?? ""}-${mode}`}
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          }
        >
          <Results query={query} cropCode={params.crop} mode={mode} />
        </Suspense>
      ) : (
        <p className="text-sm text-muted-foreground">
          Try “managing rust disease in wheat” for a match on meaning, or
          “Puccinia triticina” for one on wording. Switching the retriever
          shows what each finds on its own.
        </p>
      )}
    </div>
  );
}
