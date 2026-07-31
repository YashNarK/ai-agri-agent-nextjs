// ============================================================
// services/search.service.ts
//
// Retrieval over the agronomic knowledge base — the R in RAG.
//
// RAG (Retrieval Augmented Generation):
//   1. find the passages most likely to answer the question
//   2. pass those passages to the LLM as context
//
// Step 1 is the whole game: the generator cannot recover from a
// retriever that did not surface the right document. So this runs two
// retrievers with different failure modes and fuses their rankings:
//
//   dense (pgvector)      matches MEANING. Finds "nitrogen deficiency"
//                         from "lower leaves yellowing". Loses rare
//                         literal tokens — a variety name, "NPK
//                         20-20-20", a pathogen's binomial — because an
//                         embedding pulls them toward the topic of the
//                         sentence around them.
//
//   lexical (tsvector)    matches TOKENS. Nails the exact term and the
//                         quoted phrase. Cannot match a paraphrase at
//                         all: no shared stem, no hit, no matter how
//                         obviously the article answers the question.
//
// Neither dominates, and which one wins depends on the query, not on
// the corpus — so choosing between them per deployment is choosing
// wrong for half the traffic. Fusion happens in SQL; see
// repositories/knowledge.repository.ts for why it fuses ranks (RRF)
// rather than normalised scores.
//
// Extends services/search_service.py, which was dense-only.
// ============================================================

import type { AzureOpenAIConfig } from "@/lib/aws/app-config";
import type { SearchMode, SearchResult } from "@/lib/schemas";
import type {
  KnowledgeRepository,
  KnowledgeRow,
} from "@/repositories/knowledge.repository";
import {
  QUERY_EMBEDDING_LIMITS,
  generateEmbedding,
} from "@/services/embedding.service";

export interface KnowledgeSearchQuery {
  query: string;
  /** Required for every mode except `keyword`, which never embeds. */
  config?: AzureOpenAIConfig;
  cropCode?: string | null;
  category?: string | null;
  topK?: number;
  mode?: SearchMode;
}

export interface KnowledgeSearchOutcome {
  results: SearchResult[];
  /** The mode that ran. Differs from the request only after a fallback. */
  mode: SearchMode;
  degraded: { requested: SearchMode; reason: string } | null;
}

export class SearchService {
  constructor(private readonly knowledgeRepo: KnowledgeRepository) {}

  /**
   * Retrieve, in whichever mode was asked for.
   *
   * The one piece of behaviour worth knowing: a hybrid search whose
   * embedding call fails does NOT fail. It falls back to its lexical
   * half and says so in `degraded`.
   *
   * That is a deliberate asymmetry with `semantic` mode, which still
   * throws. Hybrid promises "the best of both"; with one retriever down
   * it can still keep half that promise, and half is plainly better
   * than an error page for a user who typed a term that lexical search
   * handles well anyway. Asking for `semantic` explicitly is asking for
   * that specific retriever, and silently substituting a different one
   * would be answering a question nobody asked.
   *
   * The fallback is reported rather than hidden — an operator seeing
   * degraded results needs to know Azure is unreachable, not conclude
   * the knowledge base got worse.
   */
  async search({
    query,
    config,
    cropCode,
    category,
    topK = 5,
    mode = "hybrid",
  }: KnowledgeSearchQuery): Promise<KnowledgeSearchOutcome> {
    if (mode === "keyword") {
      const rows = await this.knowledgeRepo.searchByKeyword({
        query,
        cropCode,
        category,
        topK,
      });
      return { results: rows.map(toResult), mode, degraded: null };
    }

    if (!config) {
      throw new Error(
        `Search mode '${mode}' needs Azure OpenAI configuration to embed the query.`,
      );
    }

    if (mode === "semantic") {
      const queryVector = await generateEmbedding(query, config);
      const rows = await this.knowledgeRepo.searchByVector({
        queryVector,
        cropCode,
        category,
        topK,
      });
      return { results: rows.map(toResult), mode, degraded: null };
    }

    let queryVector: number[];
    try {
      // Fail fast here, unlike every other embedding call: the fallback
      // below is only worth having if it arrives while the user is
      // still on the page. See QUERY_EMBEDDING_LIMITS.
      queryVector = await generateEmbedding(query, config, QUERY_EMBEDDING_LIMITS);
    } catch (error) {
      const rows = await this.knowledgeRepo.searchByKeyword({
        query,
        cropCode,
        category,
        topK,
      });
      return {
        results: rows.map(toResult),
        mode: "keyword",
        degraded: {
          requested: "hybrid",
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }

    const rows = await this.knowledgeRepo.searchHybrid({
      queryVector,
      query,
      cropCode,
      category,
      topK,
    });
    return { results: rows.map(toResult), mode: "hybrid", degraded: null };
  }

  /**
   * Dense-only search returning bare results.
   *
   * Kept as the direct port of search_service.py's entry point, for
   * callers that want the old behaviour and nothing else.
   */
  async semanticSearch(
    params: Omit<KnowledgeSearchQuery, "mode"> & { config: AzureOpenAIConfig },
  ): Promise<SearchResult[]> {
    const { results } = await this.search({ ...params, mode: "semantic" });
    return results;
  }
}

/**
 * Row → API shape.
 *
 * The rank fields are what make a hybrid result readable: "found by
 * both retrievers" and "found only because of the keyword branch" are
 * different claims about a document, and collapsing them into one score
 * throws away the reason it is on the page at all.
 */
function toResult(row: KnowledgeRow): SearchResult {
  const semanticRank = row.semantic_rank === null ? null : Number(row.semantic_rank);
  const keywordRank = row.keyword_rank === null ? null : Number(row.keyword_rank);

  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    category: row.category,
    source: row.source,
    similarity: row.similarity === null ? null : Number(row.similarity),
    keyword_score: row.keyword_score === null ? null : Number(row.keyword_score),
    score: Number(row.score),
    semantic_rank: semanticRank,
    keyword_rank: keywordRank,
    matched_by:
      semanticRank !== null && keywordRank !== null
        ? "both"
        : keywordRank !== null
          ? "keyword"
          : "semantic",
  };
}
