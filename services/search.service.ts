// ============================================================
// services/search.service.ts
//
// Semantic search using pgvector and RAG.
//
// RAG (Retrieval Augmented Generation):
//   1. embed the user query into a vector
//   2. find the most similar vectors in the database
//   3. retrieve the associated text documents
//   4. pass those documents as context to the LLM
//
// pgvector cosine similarity:
//   <=> computes cosine distance (1 - similarity)
//   ORDER BY embedding <=> :query_vector LIMIT k
//   finds the k most similar documents
//
// Port of services/search_service.py
// ============================================================

import type { AzureOpenAIConfig } from "@/lib/aws/app-config";
import type { SearchResult } from "@/lib/schemas";
import type { KnowledgeRepository } from "@/repositories/knowledge.repository";
import { generateEmbedding } from "@/services/embedding.service";

export interface SemanticSearchQuery {
  query: string;
  config: AzureOpenAIConfig;
  cropCode?: string | null;
  category?: string | null;
  topK?: number;
}

export class SearchService {
  constructor(private readonly knowledgeRepo: KnowledgeRepository) {}

  /**
   * Similarity search against the agronomic_knowledge table.
   *   1. embed the query text
   *   2. rank stored embeddings by cosine distance
   *   3. return the ranked results
   */
  async semanticSearch({
    query,
    config,
    cropCode,
    category,
    topK = 5,
  }: SemanticSearchQuery): Promise<SearchResult[]> {
    const queryVector = await generateEmbedding(query, config);

    const rows = await this.knowledgeRepo.searchByVector({
      queryVector,
      cropCode,
      category,
      topK,
    });

    return rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      content: row.content,
      category: row.category,
      source: row.source,
      similarity: Number(row.similarity),
    }));
  }
}
