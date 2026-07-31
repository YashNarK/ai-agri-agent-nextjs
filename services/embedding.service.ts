// ============================================================
// services/embedding.service.ts
//
// Azure OpenAI embedding generation.
//
// AzureOpenAIEmbeddings:
//   wraps the Azure OpenAI embeddings API
//   converts text into vector representations
//   similar texts produce similar vectors
//   used for semantic search via cosine similarity
//
// embedDocuments() vs embedQuery():
//   embedDocuments — for indexing — batch of texts
//   embedQuery     — for searching — single query text
//
// Port of services/embedding_service.py
// ============================================================

import { AzureOpenAIEmbeddings } from "@langchain/openai";

import type { AzureOpenAIConfig } from "@/lib/aws/app-config";

/**
 * How long to wait, and how hard to retry.
 *
 * These are not one setting for both callers, because the two callers
 * want opposite things:
 *
 *   INDEXING (seed:embeddings) is a background job with nobody waiting.
 *   A transient 429 should be ridden out, so it keeps LangChain's
 *   default six retries with exponential backoff.
 *
 *   A QUERY has a user in front of it, and — in hybrid search — a
 *   working fallback one line away. Retrying for a minute before taking
 *   a fallback that was available immediately is worse than not having
 *   the fallback at all: the user sees a hung page either way, and the
 *   only difference is that we also paid for six doomed requests.
 *
 * So a query fails fast and lets the caller degrade. The numbers are
 * set against a call that normally returns in well under a second.
 */
export const QUERY_EMBEDDING_LIMITS = { maxRetries: 1, timeout: 8_000 };

/**
 * Clients are keyed by deployment AND by those limits, so repeated
 * searches reuse one instance (and its keep-alive connections) instead
 * of constructing a fresh client per request as the Python version did
 * — while the query and indexing clients stay separate rather than one
 * silently inheriting whichever settings got there first.
 */
const clientCache = new Map<string, AzureOpenAIEmbeddings>();

export interface EmbeddingLimits {
  maxRetries?: number;
  timeout?: number;
}

export function getEmbeddingsClient(
  config: AzureOpenAIConfig,
  limits: EmbeddingLimits = {},
): AzureOpenAIEmbeddings {
  const key =
    `${config.embedEndpoint}::${config.embedModelName}::${config.embedApiVersion}` +
    `::${limits.maxRetries ?? "default"}::${limits.timeout ?? "default"}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new AzureOpenAIEmbeddings({
      azureOpenAIApiKey: config.embedApiKey,
      azureOpenAIApiDeploymentName: config.embedModelName,
      azureOpenAIApiVersion: config.embedApiVersion,
      azureOpenAIBasePath: toDeploymentsBasePath(config.embedEndpoint),
      ...limits,
    });
    clientCache.set(key, client);
  }
  return client;
}

/**
 * LangChain JS builds its URL from a *deployments* base path, whereas
 * the Python SDK takes the bare resource endpoint. Normalising here
 * lets the same secret value serve both apps unchanged.
 */
function toDeploymentsBasePath(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  return trimmed.endsWith("/openai/deployments")
    ? trimmed
    : `${trimmed}/openai/deployments`;
}

/** Single embedding vector for one text (1536 floats for ada-002). */
export async function generateEmbedding(
  text: string,
  config: AzureOpenAIConfig,
  limits: EmbeddingLimits = {},
): Promise<number[]> {
  return getEmbeddingsClient(config, limits).embedQuery(text);
}

/** Embeddings for many texts in one call — cheaper than looping. */
export async function generateEmbeddingsBatch(
  texts: string[],
  config: AzureOpenAIConfig,
): Promise<number[][]> {
  return getEmbeddingsClient(config).embedDocuments(texts);
}
