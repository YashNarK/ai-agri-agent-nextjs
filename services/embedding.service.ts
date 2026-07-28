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
 * Clients are keyed by deployment so repeated searches reuse one
 * instance (and its keep-alive connections) instead of constructing
 * a fresh client per request as the Python version did.
 */
const clientCache = new Map<string, AzureOpenAIEmbeddings>();

export function getEmbeddingsClient(
  config: AzureOpenAIConfig,
): AzureOpenAIEmbeddings {
  const key = `${config.embedEndpoint}::${config.embedModelName}::${config.embedApiVersion}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new AzureOpenAIEmbeddings({
      azureOpenAIApiKey: config.embedApiKey,
      azureOpenAIApiDeploymentName: config.embedModelName,
      azureOpenAIApiVersion: config.embedApiVersion,
      azureOpenAIBasePath: toDeploymentsBasePath(config.embedEndpoint),
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
): Promise<number[]> {
  return getEmbeddingsClient(config).embedQuery(text);
}

/** Embeddings for many texts in one call — cheaper than looping. */
export async function generateEmbeddingsBatch(
  texts: string[],
  config: AzureOpenAIConfig,
): Promise<number[][]> {
  return getEmbeddingsClient(config).embedDocuments(texts);
}
