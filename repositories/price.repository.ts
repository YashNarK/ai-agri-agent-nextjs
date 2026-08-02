// ============================================================
// repositories/price.repository.ts
// Historical commodity price access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export interface PriceHistoryFilter {
  cropId: number;
  regionId: number;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
}

export class PriceRepository {
  /**
   * Price rows for a (crop, region) pair, newest first, optionally
   * bounded by a date range.
   */
  async findHistory({
    cropId,
    regionId,
    dateFrom,
    dateTo,
    limit = 100,
  }: PriceHistoryFilter) {
    const prisma = await getPrisma();
    return prisma.crop_price_history.findMany({
      where: {
        crop_id: cropId,
        region_id: regionId,
        ...(dateFrom || dateTo
          ? {
              price_date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { price_date: "desc" },
      take: limit,
    });
  }

  /** The N most recent rows strictly BEFORE `beforeDate` — the lag features. */
  async findRecentBefore(
    cropId: number,
    regionId: number,
    beforeDate: Date,
    limit = 3,
  ) {
    const prisma = await getPrisma();
    return prisma.crop_price_history.findMany({
      where: {
        crop_id: cropId,
        region_id: regionId,
        price_date: { lt: beforeDate },
      },
      orderBy: { price_date: "desc" },
      take: limit,
    });
  }

  /**
   * How much history one pair has, and when it ends.
   *
   * A forecast's honesty depends on this: every target date past
   * `last` is extrapolation, and the caller has to be able to say so
   * rather than present a rolled-forward guess as a reading. One
   * aggregate rather than pulling rows, since only the bounds matter.
   */
  async historyBounds(cropId: number, regionId: number) {
    const prisma = await getPrisma();
    const result = await prisma.crop_price_history.aggregate({
      where: { crop_id: cropId, region_id: regionId },
      _count: { _all: true },
      _min: { price_date: true },
      _max: { price_date: true },
    });
    return {
      months: result._count._all,
      first: result._min.price_date,
      last: result._max.price_date,
    };
  }

  /**
   * The exact (crop, region) pairs that actually have price history,
   * with row counts and date coverage. This is the single source of
   * truth the agent and MCP server use to avoid fabricating codes.
   */
  async findAvailablePairs() {
    const prisma = await getPrisma();
    return prisma.$queryRaw<
      {
        crop_code: string;
        region_code: string;
        months: bigint;
        start_date: Date;
        end_date: Date;
      }[]
    >`
      SELECT c.code AS crop_code,
             r.code AS region_code,
             COUNT(*) AS months,
             MIN(ph.price_date) AS start_date,
             MAX(ph.price_date) AS end_date
      FROM agricultural.crop_price_history ph
      JOIN agricultural.crops   c ON ph.crop_id   = c.id
      JOIN agricultural.regions r ON ph.region_id = r.id
      GROUP BY c.code, r.code
      ORDER BY c.code, r.code
    `;
  }
}
