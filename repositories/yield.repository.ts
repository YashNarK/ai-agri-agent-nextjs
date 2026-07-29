// ============================================================
// repositories/yield.repository.ts
// Harvest yield history
// ============================================================

import { getPrisma } from "@/lib/prisma";

export interface YieldFilter {
  cropId: number;
  regionId?: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}

export class YieldRepository {
  /**
   * Yield rows for a crop, optionally scoped to one region and a year
   * range. Ascending by year so charts get them in draw order.
   */
  async findByCrop({ cropId, regionId, yearFrom, yearTo }: YieldFilter) {
    const prisma = await getPrisma();
    return prisma.crop_yield_history.findMany({
      where: {
        crop_id: cropId,
        ...(regionId ? { region_id: regionId } : {}),
        ...(yearFrom || yearTo
          ? {
              harvest_year: {
                ...(yearFrom ? { gte: yearFrom } : {}),
                ...(yearTo ? { lte: yearTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ harvest_year: "asc" }, { region_id: "asc" }],
      include: { regions: { select: { code: true, name: true } } },
    });
  }
}
