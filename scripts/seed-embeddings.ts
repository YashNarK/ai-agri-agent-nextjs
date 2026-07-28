// ============================================================
// scripts/seed-embeddings.ts
//
// Backfills the vector `embedding` column of the ONE table the app
// actually semantic-searches: agricultural.agronomic_knowledge.
//
// Every semantic-search path queries only agronomic_knowledge:
//   - services/search.service.semanticSearch  (/api/search + MCP tools)
//   - agents/tools.search_agronomic_knowledge (LangGraph chat agent)
// product_knowledge has an embedding column but no query reader, so it
// is intentionally NOT embedded here.
//
// Embeddings are generated via services/embedding.service (the same
// LangChain client the app uses at query time), so index-time and
// query-time vectors match.
//
// Writes go through raw SQL because `embedding` is
// Unsupported("vector") in the Prisma schema — the typed client cannot
// set it. Reads of which rows still need work use the typed client.
//
// Idempotent: only rows WHERE embedding IS NULL are processed and each
// batch is committed, so a re-run resumes where it left off.
//
// USAGE: npm run seed:embeddings
//
// Port of scripts/seed_embeddings.py
// ============================================================

import "dotenv/config";

import { loadAppConfig } from "../lib/aws/app-config";
import { getPrisma } from "../lib/prisma";
import { generateEmbeddingsBatch } from "../services/embedding.service";

const BATCH_SIZE = 20;
const EMBED_DIM = 1536; // agronomic_knowledge.embedding is vector(1536)

interface PendingRow {
  id: bigint;
  title: string;
  content: string;
}

function buildEmbedText(row: PendingRow): string {
  return [row.title?.trim(), row.content?.trim()].filter(Boolean).join("\n\n");
}

async function seedEmbeddings(): Promise<void> {
  console.log("🔐 Loading configuration from AWS...");
  const config = await loadAppConfig();
  const prisma = await getPrisma();
  console.log(
    `✅ Config loaded. Embedding deployment: ${config.azureOpenAI.embedModelName}`,
  );

  const [{ total, already }] = await prisma.$queryRaw<
    { total: bigint; already: bigint }[]
  >`
    SELECT COUNT(*) AS total,
           COUNT(embedding) AS already
    FROM agricultural.agronomic_knowledge
  `;
  console.log(
    `\n📊 agronomic_knowledge: ${Number(total)} total rows, ${Number(already)} already embedded`,
  );

  const rows = await prisma.$queryRaw<PendingRow[]>`
    SELECT id, title, content
    FROM agricultural.agronomic_knowledge
    WHERE embedding IS NULL
    ORDER BY id
  `;

  if (rows.length === 0) {
    console.log("✅ All rows already have embeddings — nothing to do.\n");
    return;
  }

  console.log(
    `🔄 Generating embeddings for ${rows.length} rows via embedding.service ` +
      `(batch size=${BATCH_SIZE})...\n`,
  );

  let successCount = 0;
  let failCount = 0;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const texts = batch.map(buildEmbedText);

    let vectors: number[][];
    try {
      vectors = await generateEmbeddingsBatch(texts, config.azureOpenAI);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      for (const row of batch) {
        console.log(
          `  ✗ id=${String(row.id).padStart(3)}  [${row.title.slice(0, 55)}]  ERROR: ${detail}`,
        );
        failCount += 1;
      }
      continue;
    }

    for (let i = 0; i < batch.length; i += 1) {
      const row = batch[i];
      const vector = vectors[i];

      if (vector.length !== EMBED_DIM) {
        throw new Error(
          `Embedding dimension mismatch: model returned ${vector.length} ` +
            `floats but agronomic_knowledge.embedding is vector(${EMBED_DIM}). ` +
            `Check the embed deployment (${config.azureOpenAI.embedModelName}).`,
        );
      }

      await prisma.$executeRawUnsafe(
        `UPDATE agricultural.agronomic_knowledge
         SET embedding = CAST($1 AS vector)
         WHERE id = $2`,
        `[${vector.join(",")}]`,
        row.id,
      );

      console.log(
        `  ✓ [${String(start + i + 1).padStart(3)}/${rows.length}]  ` +
          `id=${String(row.id).padStart(3)}  ${row.title.slice(0, 60)}`,
      );
      successCount += 1;
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(
    `✅ Done.  ${successCount} embeddings written to agronomic_knowledge.`,
  );
  if (failCount > 0) {
    console.log(`⚠️  ${failCount} rows failed — re-run the script to retry them.`);
  }
  console.log(`${"─".repeat(60)}\n`);
}

seedEmbeddings()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
