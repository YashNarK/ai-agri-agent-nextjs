// ============================================================
// app/api/search/route.ts
//
// POST /api/search — hybrid retrieval over the agronomic knowledge
// base: pgvector similarity and Postgres full-text search, fused.
//
// Optional: crop_code, category, top_k (default 5, max 20), and
// `mode` — "hybrid" (default), "semantic" or "keyword".
//
// The response reports the mode that ACTUALLY ran alongside the
// results, because hybrid falls back to its keyword half when the
// query cannot be embedded. A client that renders relevance needs to
// know which retrievers produced the ordering it is showing.
//
// Extends routers/search.py, which was dense-only.
// ============================================================

import { NextResponse } from "next/server";

import { loadAppConfig } from "@/lib/aws/app-config";
import { searchService } from "@/lib/container";
import { requireApprovedApi } from "@/lib/auth/guard";
import { ApiError, toErrorResponse } from "@/lib/errors";
import { searchRequestSchema, type SearchResponse } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // Every mode but "keyword" embeds the search text through Azure
    // OpenAI, so this endpoint bills per call. Guarded uniformly rather
    // than per mode: a free path into the same corpus, reachable by
    // flipping one request field, would make the guard decorative.
    await requireApprovedApi();

    const parsed = searchRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { query, crop_code, category, top_k, mode } = parsed.data;

    // Keyword search reaches no external service, so it must not be
    // held hostage to a config load that only the other modes need —
    // that is the whole point of having it as a fallback.
    const config = mode === "keyword" ? undefined : await loadAppConfig();

    const outcome = await searchService.search({
      query,
      config: config?.azureOpenAI,
      cropCode: crop_code,
      category,
      topK: top_k,
      mode,
    });

    const response: SearchResponse = {
      query,
      results: outcome.results,
      total: outcome.results.length,
      mode: outcome.mode,
      degraded: outcome.degraded,
    };

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
