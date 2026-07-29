// ============================================================
// repositories/weather.repository.ts
// Weather and drought observations
// ============================================================

import { getPrisma } from "@/lib/prisma";

export interface WeatherRangeFilter {
  regionId: number;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
}

export class WeatherRepository {
  /** Most recent observations for a region, newest first. */
  async findRecentByRegion(regionId: number, limit = 3) {
    const prisma = await getPrisma();
    return prisma.weather_data.findMany({
      where: { region_id: regionId },
      orderBy: { weather_date: "desc" },
      take: limit,
    });
  }

  /**
   * Observations over a date range, ASCENDING — charts plot left to right,
   * so returning them in draw order saves every caller a reverse().
   */
  async findRange({ regionId, dateFrom, dateTo, limit = 365 }: WeatherRangeFilter) {
    const prisma = await getPrisma();
    return prisma.weather_data.findMany({
      where: {
        region_id: regionId,
        ...(dateFrom || dateTo
          ? {
              weather_date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { weather_date: "asc" },
      take: limit,
    });
  }
}
