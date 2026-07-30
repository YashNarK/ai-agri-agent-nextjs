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
  /** Rows to skip — page offset. */
  skip?: number;
  /** Free text matched against crop and region code or name. */
  search?: string | null;
}

/**
 * The filter shared by `list` and `count`, so a page and its total can
 * never disagree about what is being counted.
 *
 * Search spans the crop and region JOINs rather than the prediction row
 * itself: a forecast has no text of its own worth matching, and "MAIZE"
 * or "Punjab" is what a reader actually types.
 */
function buildWhere({ cropId, regionId, search }: PredictionListFilter) {
  const term = search?.trim();

  return {
    ...(cropId ? { crop_id: cropId } : {}),
    ...(regionId ? { region_id: regionId } : {}),
    ...(term
      ? {
          OR: [
            { crops: { code: { contains: term, mode: "insensitive" as const } } },
            { crops: { name: { contains: term, mode: "insensitive" as const } } },
            { regions: { code: { contains: term, mode: "insensitive" as const } } },
            { regions: { name: { contains: term, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export class PredictionRepository {
  /**
   * Forecasts already logged by predictions.service. Reading these is
   * free — the Azure ML call happened when they were created — so the
   * forecast views browse history without re-scoring anything.
   */
  async list({
    cropId,
    regionId,
    limit = 100,
    skip = 0,
    search,
  }: PredictionListFilter) {
    const prisma = await getPrisma();
    return prisma.price_predictions.findMany({
      where: buildWhere({ cropId, regionId, search }),
      // `id` is a tiebreaker, not decoration. prediction_date is NOT
      // unique — bulk-seeded rows share a timestamp — and ordering by a
      // non-unique key leaves the order among ties undefined. Postgres
      // is then free to return them differently for each LIMIT/OFFSET
      // query, so a row could appear on two pages and another on none.
      // Paging is only stable over a total order.
      orderBy: [{ prediction_date: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      include: {
        crops: { select: { code: true, name: true } },
        regions: { select: { code: true, name: true } },
      },
    });
  }

  /**
   * One forecast by id, with its crop and region.
   *
   * Needed because the selected forecast is addressed by `?id=` and may
   * not be on the page currently shown — a fresh run, or any search
   * filter, puts it outside the visible rows.
   */
  async findById(id: number) {
    const prisma = await getPrisma();
    return prisma.price_predictions.findUnique({
      where: { id },
      include: {
        crops: { select: { code: true, name: true } },
        regions: { select: { code: true, name: true } },
      },
    });
  }

  /**
   * How many rows match, ignoring pagination.
   *
   * Needed separately because a page of results cannot tell you how many
   * pages exist — and with 750+ forecasts, "showing 20 of ?" is not a
   * usable control.
   */
  async count({ cropId, regionId, search }: PredictionListFilter) {
    const prisma = await getPrisma();
    return prisma.price_predictions.count({
      where: buildWhere({ cropId, regionId, search }),
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
