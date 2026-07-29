// ============================================================
// repositories/prediction.repository.ts
// Audit log of every forecast the platform has served
// ============================================================

import type { Prisma } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

export interface CreatePredictionInput {
  cropId: number;
  regionId: number;
  targetDate: Date;
  predictedPrice: number;
  confidenceLow: number | null;
  confidenceHigh: number | null;
  modelVersion: string;
  featuresUsed: Record<string, unknown>;
}

export interface PredictionListFilter {
  cropId?: number | null;
  regionId?: number | null;
  limit?: number;
}

export class PredictionRepository {
  /**
   * Forecasts already logged by predictions.service. Reading these is
   * free — the Azure ML call happened when they were created — so the
   * forecast views browse history without re-scoring anything.
   */
  async list({ cropId, regionId, limit = 100 }: PredictionListFilter) {
    const prisma = await getPrisma();
    return prisma.price_predictions.findMany({
      where: {
        ...(cropId ? { crop_id: cropId } : {}),
        ...(regionId ? { region_id: regionId } : {}),
      },
      orderBy: { prediction_date: "desc" },
      take: limit,
      include: {
        crops: { select: { code: true, name: true } },
        regions: { select: { code: true, name: true } },
      },
    });
  }

  async create(input: CreatePredictionInput) {
    const prisma = await getPrisma();
    return prisma.price_predictions.create({
      data: {
        crop_id: input.cropId,
        region_id: input.regionId,
        target_date: input.targetDate,
        predicted_price: input.predictedPrice,
        confidence_low: input.confidenceLow,
        confidence_high: input.confidenceHigh,
        model_version: input.modelVersion,
        features_used: input.featuresUsed as Prisma.InputJsonValue,
      },
    });
  }
}
