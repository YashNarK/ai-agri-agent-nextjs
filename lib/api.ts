// ============================================================
// lib/api.ts
//
// Server-side data access for pages.
//
// Server Components call the SERVICES directly rather than fetching our
// own HTTP routes: the route handler would only parse a URL we just
// built and call the same service, so going over the network would add
// a round trip, a serialisation hop and a second failure mode for
// nothing. The HTTP routes remain the contract for external clients and
// for Client Components.
// ============================================================

import type { AzureOpenAIConfig } from "@/lib/aws/app-config";
import type { SearchMode } from "@/lib/schemas";
import {
  cropsService,
  indicatorsService,
  predictionsService,
  pricesService,
  regionsService,
  searchService,
  weatherService,
  yieldsService,
} from "@/lib/container";

export async function getCrops() {
  return cropsService.listCrops();
}

export async function getCrop(cropCode: string) {
  return cropsService.getCropByCode(cropCode);
}

export async function getRegions() {
  return regionsService.listRegions();
}

export async function getAvailablePairs() {
  return pricesService.getAvailablePairs();
}

export async function getPriceHistory(
  cropCode: string,
  regionCode: string,
  limit = 200,
) {
  return pricesService.getPriceHistory({ cropCode, regionCode, limit });
}

export async function getIndicators(names?: string[]) {
  return indicatorsService.getSeries({ names: names ?? null });
}

export async function getRegion(regionCode: string) {
  return regionsService.getRegionByCode(regionCode);
}

export async function getWeather(regionCode: string, limit = 400) {
  return weatherService.getWeather({ regionCode, limit });
}

export async function getYields(cropCode: string, regionCode?: string) {
  return yieldsService.getYields({ cropCode, regionCode: regionCode ?? null });
}

/** Reads already-logged forecasts. Does NOT call Azure ML. */
export async function getLoggedPredictions(
  limit = 50,
  page = 1,
  search?: string | null,
) {
  return predictionsService.listPredictions({ limit, page, search });
}

/** One logged forecast by id, for the `?id=` selection. */
export async function getPrediction(id: number) {
  return Number.isFinite(id) ? predictionsService.getPrediction(id) : null;
}

/**
 * Hybrid knowledge search. Unlike everything else here this DOES call
 * out — Azure OpenAI, to embed the query — so it can fail independently
 * of the database.
 *
 * Returns the outcome rather than bare results: the caller has to know
 * whether it is rendering a fused ranking or the keyword half on its
 * own after a fallback.
 */
export async function searchKnowledge(
  query: string,
  cropCode?: string | null,
  topK = 5,
  mode: SearchMode = "hybrid",
) {
  // Only resolved when a query vector is actually needed, so keyword
  // search keeps working on a box with no AWS credentials at all.
  let config: AzureOpenAIConfig | undefined;
  if (mode !== "keyword") {
    const { loadAppConfig } = await import("@/lib/aws/app-config");
    config = (await loadAppConfig()).azureOpenAI;
  }

  return searchService.search({ query, config, cropCode, topK, mode });
}
