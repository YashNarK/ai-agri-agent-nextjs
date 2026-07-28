// ============================================================
// services/regions.service.ts
// Region reference-data business logic
//
// Port of services/region_service.py
// ============================================================

import { notFound } from "@/lib/errors";
import type { RegionSchema } from "@/lib/schemas";
import { toNumberOrNull } from "@/lib/serialize";
import type { RegionRepository } from "@/repositories/region.repository";

type RegionRow = Awaited<ReturnType<RegionRepository["findByCode"]>>;

export function toRegionSchema(region: NonNullable<RegionRow>): RegionSchema {
  return {
    id: region.id,
    code: region.code,
    name: region.name,
    country: region.country,
    climate: region.climate,
    latitude: toNumberOrNull(region.latitude),
    longitude: toNumberOrNull(region.longitude),
  };
}

export class RegionsService {
  constructor(private readonly regionsRepo: RegionRepository) {}

  async listRegions(): Promise<RegionSchema[]> {
    const regions = await this.regionsRepo.findAll();
    return regions.map(toRegionSchema);
  }

  async getRegionByCode(regionCode: string): Promise<RegionSchema> {
    const region = await this.regionsRepo.findByCode(regionCode);
    if (!region) {
      throw notFound(`Region ${regionCode} not found`);
    }
    return toRegionSchema(region);
  }

  /** 404-or-row variant used by the price and prediction services. */
  async requireRegionByCode(regionCode: string) {
    const region = await this.regionsRepo.findByCode(regionCode);
    if (!region) {
      throw notFound(`Region ${regionCode} not found`);
    }
    return region;
  }
}
