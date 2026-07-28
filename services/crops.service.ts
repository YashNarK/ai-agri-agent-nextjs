// ============================================================
// services/crops.service.ts
// Crop reference-data business logic
//
// Port of services/crop_service.py
// ============================================================

import { notFound } from "@/lib/errors";
import type { CropListResponse, CropSchema } from "@/lib/schemas";
import { toNumberOrNull } from "@/lib/serialize";
import type { CropRepository } from "@/repositories/crop.repository";

type CropRow = Awaited<ReturnType<CropRepository["findByCode"]>>;

/** Prisma row → API shape (Decimal columns become plain numbers). */
export function toCropSchema(crop: NonNullable<CropRow>): CropSchema {
  return {
    id: crop.id,
    code: crop.code,
    name: crop.name,
    category: crop.category,
    sub_category: crop.sub_category,
    scientific_name: crop.scientific_name,
    growing_season: crop.growing_season,
    avg_yield_per_ha: toNumberOrNull(crop.avg_yield_per_ha),
  };
}

export class CropsService {
  constructor(private readonly cropsRepo: CropRepository) {}

  /** Every crop ordered by name, with a total count. */
  async listCrops(): Promise<CropListResponse> {
    const crops = await this.cropsRepo.findAll();
    return {
      crops: crops.map(toCropSchema),
      total: crops.length,
    };
  }

  /** Resolves a single crop by code, or throws 404. */
  async getCropByCode(cropCode: string): Promise<CropSchema> {
    const crop = await this.cropsRepo.findByCode(cropCode);
    if (!crop) {
      throw notFound(`Crop ${cropCode} not found`);
    }
    return toCropSchema(crop);
  }

  /**
   * Same 404 semantics, but returns the raw row — the price and
   * prediction services need the numeric `id` for their joins.
   */
  async requireCropByCode(cropCode: string) {
    const crop = await this.cropsRepo.findByCode(cropCode);
    if (!crop) {
      throw notFound(`Crop ${cropCode} not found`);
    }
    return crop;
  }
}
