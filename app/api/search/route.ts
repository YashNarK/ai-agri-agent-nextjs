// ============================================================
// app/api/search/route.ts
//
// POST /api/search — vector similarity search over the agronomic
// knowledge base using Azure OpenAI embeddings and pgvector.
//
// The query is embedded into a high-dimensional vector and compared
// against stored document embeddings. The most semantically similar
// documents are returned, ranked by cosine similarity.
//
// Optional filters: crop_code, category, top_k (default 5, max 20).
//
// Port of routers/search.py
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
    // Every query embeds the search text through Azure OpenAI before it
    // touches pgvector, so this endpoint bills per call.
    await requireApprovedApi();

    const parsed = searchRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ApiError(422, parsed.error.issues[0].message);
    }

    const { query, crop_code, category, top_k } = parsed.data;
    const config = await loadAppConfig();

    const results = await searchService.semanticSearch({
      query,
      config: config.azureOpenAI,
      cropCode: crop_code,
      category,
      topK: top_k,
    });

    const response: SearchResponse = {
      query,
      results,
      total: results.length,
    };

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}
