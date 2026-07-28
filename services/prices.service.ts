// ============================================================
// services/prices.service.ts
// Historical commodity price access
//
// Port of services/price_service.py
// ============================================================

import type { PriceHistoryResponse, PriceHistorySchema } from "@/lib/schemas";
import { toDateString, toNumber, toNumberOrNull } from "@/lib/serialize";
import type { PriceRepository } from "@/repositories/price.repository";
import type { CropsService } from "@/services/crops.service";
import type { RegionsService } from "@/services/regions.service";

type PriceRow = Awaited<ReturnType<PriceRepository["findHistory"]>>[number];

export function toPriceHistorySchema(row: PriceRow): PriceHistorySchema {
  return {
    id: Number(row.id),
    crop_id: row.crop_id,
    region_id: row.region_id,
    price_date: toDateString(row.price_date),
    price_usd_tonne: toNumber(row.price_usd_tonne),
    volume_traded: toNumberOrNull(row.volume_traded),
    source: row.source,
  };
}

export interface PriceHistoryQuery {
  cropCode: string;
  regionCode: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
}

export class PricesService {
  constructor(
    private readonly priceRepo: PriceRepository,
    private readonly cropsService: CropsService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * Historical prices for a crop in a region, optionally bounded by a
   * date range. Unknown crop/region → 404; a valid pair with no rows in
   * the window → an empty list, not a 404.
   */
  async getPriceHistory({
    cropCode,
    regionCode,
    dateFrom,
    dateTo,
    limit = 100,
  }: PriceHistoryQuery): Promise<PriceHistoryResponse> {
    const crop = await this.cropsService.requireCropByCode(cropCode);
    const region = await this.regionsService.requireRegionByCode(regionCode);

    const prices = await this.priceRepo.findHistory({
      cropId: crop.id,
      regionId: region.id,
      dateFrom,
      dateTo,
      limit,
    });

    return {
      prices: prices.map(toPriceHistorySchema),
      total: prices.length,
      crop: crop.name,
      region: region.name,
    };
  }
}
