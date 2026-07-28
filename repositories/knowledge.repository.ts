// ============================================================
// repositories/knowledge.repository.ts
//
// pgvector similarity search over the agronomic knowledge base.
//
// Raw SQL on purpose: `embedding` is `Unsupported("vector")` in the
// Prisma schema, so the typed client cannot select it or express the
// `<=>` cosine-distance operator. This mirrors the Python app, which
// used raw SQL through SQLAlchemy for exactly the same reason.
//
// Values are bound as $1/$2/... parameters — never interpolated —
// so this is not an injection surface despite being "unsafe" API.
// ============================================================

import { getPrisma } from "@/lib/prisma";

export interface KnowledgeRow {
  id: bigint;
  title: string;
  content: string;
  category: string | null;
  source: string | null;
  similarity: number;
}

export interface VectorSearchOptions {
  queryVector: number[];
  cropCode?: string | null;
  category?: string | null;
  topK?: number;
}

export class KnowledgeRepository {
  /**
   * Returns the topK most semantically similar knowledge articles.
   * `1 - (embedding <=> query)` converts cosine distance to similarity.
   */
  async searchByVector({
    queryVector,
    cropCode,
    category,
    topK = 5,
  }: VectorSearchOptions): Promise<KnowledgeRow[]> {
    const prisma = await getPrisma();

    // pgvector accepts its literal form: '[0.1,0.2,...]'
    const params: unknown[] = [`[${queryVector.join(",")}]`];

    let sql = `
      SELECT
          ak.id,
          ak.title,
          ak.content,
          ak.category,
          ak.source,
          1 - (ak.embedding <=> CAST($1 AS vector)) AS similarity
      FROM agricultural.agronomic_knowledge ak
      LEFT JOIN agricultural.crops c ON ak.crop_id = c.id
      WHERE ak.embedding IS NOT NULL
    `;

    if (cropCode) {
      params.push(cropCode);
      sql += ` AND c.code = $${params.length}`;
    }

    if (category) {
      params.push(category);
      sql += ` AND ak.category = $${params.length}`;
    }

    params.push(topK);
    sql += ` ORDER BY ak.embedding <=> CAST($1 AS vector) LIMIT $${params.length}`;

    return prisma.$queryRawUnsafe<KnowledgeRow[]>(sql, ...params);
  }
}
