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

import {
  cropsService,
  indicatorsService,
  pricesService,
  regionsService,
} from "@/lib/container";

export async function getCrops() {
  return cropsService.listCrops();
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
