// ============================================================
// repositories/knowledge.repository.ts
//
// Retrieval over the agronomic knowledge base: dense (pgvector),
// lexical (Postgres full-text), and the hybrid fusion of the two.
//
// Raw SQL on purpose: `embedding` is `Unsupported("vector")` in the
// Prisma schema, so the typed client cannot select it or express the
// `<=>` cosine-distance operator. `search_tsv` is `Unsupported("tsvector")`
// for the same reason. This mirrors the Python app, which used raw SQL
// through SQLAlchemy for exactly the same reason.
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
  /** Cosine similarity to the query vector. Null in keyword-only search. */
  similarity: number | null;
  /** ts_rank_cd against the parsed query. Null when the lexical branch did not run or did not match. */
  keyword_score: number | null;
  /** Fused score the ordering is by. Equals the single branch's contribution when only one ran. */
  score: number;
  /** 1-based position within each branch's own ranking; null if that branch did not return the row. */
  semantic_rank: number | null;
  keyword_rank: number | null;
}

export interface SearchFilters {
  cropCode?: string | null;
  category?: string | null;
}

export interface VectorSearchOptions extends SearchFilters {
  queryVector: number[];
  topK?: number;
}

export interface KeywordSearchOptions extends SearchFilters {
  query: string;
  topK?: number;
}

export interface HybridSearchOptions extends SearchFilters {
  queryVector: number[];
  query: string;
  topK?: number;
  /** How deep each branch ranks before fusion. See RRF note below. */
  poolSize?: number;
}

/**
 * Reciprocal Rank Fusion constant, from Cormack et al. (2009), where 60
 * was found to work across test collections without tuning.
 *
 * WHY FUSE RANKS AND NOT SCORES
 *
 * Cosine similarity and ts_rank_cd are not the same kind of number.
 * Cosine sits in a narrow band near the top (0.78 vs 0.82 is a large
 * difference in practice), ts_rank_cd is unbounded and depends on
 * document length and term frequency. Normalising them onto a shared
 * 0–1 scale — min-max over the result set, say — makes the fused score
 * depend on which OTHER documents happened to be retrieved, so adding
 * an eleventh candidate can reorder the top three.
 *
 * RRF throws the magnitudes away and keeps only the ordering each
 * retriever is actually reliable about: a document's contribution is
 * 1/(k + rank). With k = 60 the gap between rank 1 and rank 2 is small,
 * so agreement between the two retrievers outweighs a narrow win in
 * either — which is the entire point of running both.
 */
const RRF_K = 60;

/**
 * Default depth per branch. Fusion can only promote what at least one
 * branch retrieved, so the pool must be meaningfully deeper than topK:
 * the documents hybrid search exists to find are the ones ranked ~15th
 * by one retriever and 2nd by the other.
 */
const DEFAULT_POOL_SIZE = 50;

/** Accumulates bound values and hands back the `$n` placeholder for each. */
class Params {
  readonly values: unknown[] = [];
  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Filter predicates, rendered for whichever table aliases the caller is
 * using.
 *
 * Emitted as a fragment and pasted into each branch rather than
 * factored into a CTE they all select from: a CTE referenced more than
 * once is materialised by Postgres, and scanning a materialised result
 * cannot use the ivfflat or GIN index. Copies of one predicate are the
 * cheaper duplication. Values are bound ONCE — the same `$n` is simply
 * referenced from every copy.
 */
type AliasedFragment = (knowledge: string, crop: string) => string;
/** Aliases default to the `ak` / `c` pair every top-level branch uses. */
type FilterRenderer = (knowledge?: string, crop?: string) => string;

function buildFilters(
  params: Params,
  { cropCode, category }: SearchFilters,
): FilterRenderer {
  const parts: AliasedFragment[] = [];
  if (cropCode) {
    const p = params.bind(cropCode);
    parts.push((_ak, c) => ` AND ${c}.code = ${p}`);
  }
  if (category) {
    const p = params.bind(category);
    parts.push((ak) => ` AND ${ak}.category = ${p}`);
  }
  return (ak = "ak", c = "c") => parts.map((part) => part(ak, c)).join("");
}

/**
 * The lexical query, as a one-row CTE named `q` holding column `ts`.
 *
 * WHY THE QUERY IS PARSED TWICE
 *
 * websearch_to_tsquery ANDs the terms it finds, which is right for a
 * search box and catastrophic for a question. "how do I manage rust
 * disease in wheat?" parses to 'manag' & 'rust' & 'diseas' & 'wheat',
 * and no article in this corpus contains all four stems — so the
 * lexical branch returns NOTHING and hybrid silently degrades to the
 * dense branch it was built to complement. Measured, not assumed: every
 * natural-language probe against the live knowledge base returned zero
 * rows under the conjunctive parse.
 *
 * So: prefer the conjunctive parse, and fall back to the disjunctive
 * one only when it matches nothing. Documents matching more of the
 * query still sort first, because that is what ts_rank_cd measures —
 * the fallback widens what is retrievable without flattening the order.
 *
 * The rewrite is a regex over the parsed tsquery's text, and the
 * negative lookahead is the point of it: ' & ' becomes ' | ' EXCEPT
 * before '!', so a "-excluded" term stays excluded instead of becoming
 * an alternative that matches nearly everything. Phrase operators
 * (<->) are untouched, so "quoted phrases" survive too.
 *
 * websearch_to_tsquery rather than to_tsquery for the parse itself:
 * it accepts what people already type, and never throws on malformed
 * input — to_tsquery raises a syntax error on a bare '&', which would
 * turn a typo into a 500.
 */
function tsqueryCte(param: string, filters: FilterRenderer): string {
  const strict = `websearch_to_tsquery('english', ${param})`;
  const loose = `regexp_replace(${strict}::text, ' & (?!!)', ' | ', 'g')::tsquery`;

  return `
      q AS (
          SELECT CASE WHEN EXISTS (
              SELECT 1
              FROM agricultural.agronomic_knowledge probe
              LEFT JOIN agricultural.crops probe_c ON probe.crop_id = probe_c.id
              WHERE probe.search_tsv @@ ${strict}${filters("probe", "probe_c")}
          ) THEN ${strict} ELSE ${loose} END AS ts
      )`;
}

export class KnowledgeRepository {
  /**
   * Dense retrieval alone: the topK nearest embeddings.
   * `1 - (embedding <=> query)` converts cosine distance to similarity.
   */
  async searchByVector({
    queryVector,
    cropCode,
    category,
    topK = 5,
  }: VectorSearchOptions): Promise<KnowledgeRow[]> {
    const prisma = await getPrisma();
    const params = new Params();

    // pgvector accepts its literal form: '[0.1,0.2,...]'
    const vec = `CAST(${params.bind(`[${queryVector.join(",")}]`)} AS vector)`;
    const filters = buildFilters(params, { cropCode, category })();

    // The ORDER BY + LIMIT sits in a subquery and ROW_NUMBER is applied
    // outside it. Ranking in the same query level would make Postgres
    // compute the window over every matching row — a full sort, and the
    // end of any ivfflat index scan. See searchHybrid for the same shape.
    const sql = `
      SELECT
          nearest.id,
          nearest.title,
          nearest.content,
          nearest.category,
          nearest.source,
          (1 - nearest.distance)::double precision AS similarity,
          NULL::double precision AS keyword_score,
          (1 - nearest.distance)::double precision AS score,
          (ROW_NUMBER() OVER (ORDER BY nearest.distance))::int AS semantic_rank,
          NULL::int AS keyword_rank
      FROM (
          SELECT ak.id, ak.title, ak.content, ak.category, ak.source,
                 (ak.embedding <=> ${vec}) AS distance
          FROM agricultural.agronomic_knowledge ak
          LEFT JOIN agricultural.crops c ON ak.crop_id = c.id
          WHERE ak.embedding IS NOT NULL${filters}
          ORDER BY ak.embedding <=> ${vec}
          LIMIT ${params.bind(topK)}
      ) nearest
      ORDER BY nearest.distance
    `;

    return prisma.$queryRawUnsafe<KnowledgeRow[]>(sql, ...params.values);
  }

  /**
   * Lexical retrieval alone: rows whose tsvector matches the parsed
   * query, ranked by ts_rank_cd.
   *
   * Worth having on its own and not only as half of the hybrid: it
   * costs nothing per call and touches no external service, so it is
   * what search degrades TO when Azure OpenAI cannot embed the query.
   * A knowledge base that answers exact-term questions beats one that
   * returns an error page.
   */
  async searchByKeyword({
    query,
    cropCode,
    category,
    topK = 5,
  }: KeywordSearchOptions): Promise<KnowledgeRow[]> {
    const prisma = await getPrisma();
    const params = new Params();

    const renderFilters = buildFilters(params, { cropCode, category });
    const cte = tsqueryCte(params.bind(query), renderFilters);
    const filters = renderFilters();

    // ts_rank_cd, not ts_rank: the cover-density variant rewards query
    // terms appearing NEAR each other, so an article that discusses
    // "nitrogen" and "deficiency" in one paragraph outranks one that
    // mentions each in unrelated sections.
    const rank = `ts_rank_cd(ak.search_tsv, q.ts)`;

    const sql = `
      WITH ${cte}
      SELECT
          matched.id,
          matched.title,
          matched.content,
          matched.category,
          matched.source,
          NULL::double precision AS similarity,
          matched.keyword_score,
          matched.keyword_score AS score,
          NULL::int AS semantic_rank,
          (ROW_NUMBER() OVER (ORDER BY matched.keyword_score DESC, matched.id))::int AS keyword_rank
      FROM (
          SELECT ak.id, ak.title, ak.content, ak.category, ak.source,
                 ${rank}::double precision AS keyword_score
          FROM agricultural.agronomic_knowledge ak
          CROSS JOIN q
          LEFT JOIN agricultural.crops c ON ak.crop_id = c.id
          WHERE ak.search_tsv @@ q.ts${filters}
          ORDER BY ${rank} DESC, ak.id
          LIMIT ${params.bind(topK)}
      ) matched
      ORDER BY matched.keyword_score DESC, matched.id
    `;

    return prisma.$queryRawUnsafe<KnowledgeRow[]>(sql, ...params.values);
  }

  /**
   * Both retrievers, fused by Reciprocal Rank Fusion.
   *
   * One statement rather than two round trips and a merge in JS: the
   * branches are independent, so Postgres can run them without waiting
   * on the application, and the FULL OUTER JOIN is exactly the "matched
   * by either" semantics we want. Doing it here also keeps the pool
   * (50 rows x content) inside the database instead of shipping it over
   * the wire to throw most of it away.
   *
   * `similarity` is recomputed in the outer SELECT rather than carried
   * out of the semantic branch, so a row the keyword branch found — and
   * the vector search missed — still reports how far away it actually
   * was. That number is the honest signal of what fusion just rescued.
   */
  async searchHybrid({
    queryVector,
    query,
    cropCode,
    category,
    topK = 5,
    poolSize = DEFAULT_POOL_SIZE,
  }: HybridSearchOptions): Promise<KnowledgeRow[]> {
    const prisma = await getPrisma();
    const params = new Params();

    const vec = `CAST(${params.bind(`[${queryVector.join(",")}]`)} AS vector)`;

    // Bound once, referenced by both branches. The same $n may appear
    // any number of times in one statement.
    const renderFilters = buildFilters(params, { cropCode, category });
    const cte = tsqueryCte(params.bind(query), renderFilters);
    const filters = renderFilters();
    const rank = `ts_rank_cd(ak.search_tsv, q.ts)`;
    const pool = params.bind(poolSize);

    const sql = `
      WITH ${cte},
      semantic AS (
          -- Rank OUTSIDE the LIMIT, never beside it: a window function
          -- in the same query level is evaluated over every matching
          -- row, which means a full sort and no ivfflat index scan.
          -- Here the subquery returns poolSize rows in index order and
          -- the window numbers just those.
          SELECT
              nearest.id,
              (ROW_NUMBER() OVER (ORDER BY nearest.distance))::int AS rank
          FROM (
              SELECT ak.id, (ak.embedding <=> ${vec}) AS distance
              FROM agricultural.agronomic_knowledge ak
              LEFT JOIN agricultural.crops c ON ak.crop_id = c.id
              WHERE ak.embedding IS NOT NULL${filters}
              ORDER BY ak.embedding <=> ${vec}
              LIMIT ${pool}
          ) nearest
      ),
      keyword AS (
          SELECT
              matched.id,
              matched.score,
              (ROW_NUMBER() OVER (ORDER BY matched.score DESC, matched.id))::int AS rank
          FROM (
              SELECT ak.id, ${rank}::double precision AS score
              FROM agricultural.agronomic_knowledge ak
              CROSS JOIN q
              LEFT JOIN agricultural.crops c ON ak.crop_id = c.id
              WHERE ak.search_tsv @@ q.ts${filters}
              ORDER BY ${rank} DESC, ak.id
              LIMIT ${pool}
          ) matched
      ),
      fused AS (
          SELECT
              COALESCE(s.id, k.id) AS id,
              s.rank AS semantic_rank,
              k.rank AS keyword_rank,
              k.score AS keyword_score,
              (
                  COALESCE(1.0 / (${RRF_K} + s.rank), 0) +
                  COALESCE(1.0 / (${RRF_K} + k.rank), 0)
              )::double precision AS score
          FROM semantic s
          FULL OUTER JOIN keyword k ON s.id = k.id
      )
      SELECT
          ak.id,
          ak.title,
          ak.content,
          ak.category,
          ak.source,
          (1 - (ak.embedding <=> ${vec}))::double precision AS similarity,
          f.keyword_score,
          f.score,
          f.semantic_rank,
          f.keyword_rank
      FROM fused f
      JOIN agricultural.agronomic_knowledge ak ON ak.id = f.id
      ORDER BY f.score DESC, ak.id
      LIMIT ${params.bind(topK)}
    `;

    return prisma.$queryRawUnsafe<KnowledgeRow[]>(sql, ...params.values);
  }
}
