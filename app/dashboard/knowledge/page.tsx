// ============================================================
// app/dashboard/knowledge/page.tsx
//
// Semantic search over the agronomic knowledge base.
//
// Unlike every other dashboard page, this one depends on an EXTERNAL
// service: the query is embedded by Azure OpenAI before pgvector can
// rank anything. So it fails independently of the database, and the
// failure is surfaced as a real message rather than an empty result —
// "no matches" and "the embedding service is unreachable" mean very
// different things to a user.
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
import { requireApproved } from "@/lib/auth/guard";
import { getCrops, searchKnowledge } from "@/lib/api";

import { SearchForm } from "./search-form";

export const metadata = { title: "Knowledge" };
export const dynamic = "force-dynamic";

async function Results({
  query,
  cropCode,
}: {
  query: string;
  cropCode?: string;
}) {
  let results;
  try {
    results = await searchKnowledge(query, cropCode ?? null, 8);
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

  if (results.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No articles matched “{query}”.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {results.length} articles, ranked by cosine similarity.
      </p>
      {results.map((result) => (
        <Card key={result.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <CardTitle className="text-base">{result.title}</CardTitle>
              {result.category && (
                <Badge variant="secondary">{result.category}</Badge>
              )}
            </div>
            <CardDescription>
              {result.source ?? "Unknown source"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SimilarityBar value={result.similarity} />
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

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; crop?: string }>;
}) {
  // Before anything is read: this page embeds the query through Azure
  // OpenAI. proxy.ts already redirects visitors with no session cookie,
  // but that check is optimistic and never sees approval status.
  await requireApproved("/dashboard/knowledge");

  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const crops = await getCrops();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Agronomic knowledge
        </h1>
        <p className="text-sm text-muted-foreground">
          Vector similarity search over the knowledge base. Ask in plain
          language — this matches on meaning, not keywords.
        </p>
      </header>

      <SearchForm
        crops={crops.crops.map((c) => ({ code: c.code, name: c.name }))}
        query={query}
        cropCode={params.crop ?? ""}
      />

      {query ? (
        <Suspense
          key={`${query}-${params.crop ?? ""}`}
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          }
        >
          <Results query={query} cropCode={params.crop} />
        </Suspense>
      ) : (
        <p className="text-sm text-muted-foreground">
          Try “managing rust disease in wheat” or “nitrogen timing for maize”.
        </p>
      )}
    </div>
  );
}
