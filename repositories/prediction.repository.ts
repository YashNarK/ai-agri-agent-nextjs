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

export class PredictionRepository {
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
