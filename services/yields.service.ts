// ============================================================
// services/yields.service.ts
// Harvest yield history
// ============================================================

import type { YieldResponse, YieldSchema } from "@/lib/schemas";
import { toNumber, toNumberOrNull } from "@/lib/serialize";
import type { YieldRepository } from "@/repositories/yield.repository";
import type { CropsService } from "@/services/crops.service";
import type { RegionsService } from "@/services/regions.service";

type YieldRow = Awaited<ReturnType<YieldRepository["findByCrop"]>>[number];

export function toYieldSchema(row: YieldRow): YieldSchema {
  return {
    id: row.id,
    crop_id: row.crop_id,
    region_id: row.region_id,
    region_code: row.regions.code,
    region_name: row.regions.name,
    harvest_year: row.harvest_year,
    yield_tonnes_ha: toNumber(row.yield_tonnes_ha),
    area_harvested_ha: toNumberOrNull(row.area_harvested_ha),
    total_production_tonnes: toNumberOrNull(row.total_production_tonnes),
    quality_grade: row.quality_grade,
  };
}

export interface YieldQuery {
  cropCode: string;
  regionCode?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

export class YieldsService {
  constructor(
    private readonly yieldRepo: YieldRepository,
    private readonly cropsService: CropsService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * Yield history for a crop, optionally scoped to one region.
   * Region is joined in so the scatter plot can label points without a
   * second round trip.
   */
  async getYields({
    cropCode,
    regionCode,
    yearFrom,
    yearTo,
  }: YieldQuery): Promise<YieldResponse> {
    const crop = await this.cropsService.requireCropByCode(cropCode);

    // resolve the region only when one was asked for, so an unknown
    // region still 404s rather than being silently ignored
    const region = regionCode
      ? await this.regionsService.requireRegionByCode(regionCode)
      : null;

    const rows = await this.yieldRepo.findByCrop({
      cropId: crop.id,
      regionId: region?.id ?? null,
      yearFrom,
      yearTo,
    });

    return {
      crop: crop.name,
      crop_code: crop.code,
      yields: rows.map(toYieldSchema),
      total: rows.length,
    };
  }
}
