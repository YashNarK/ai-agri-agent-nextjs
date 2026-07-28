// ============================================================
// repositories/weather.repository.ts
// Weather and drought observations
// ============================================================

import { getPrisma } from "@/lib/prisma";

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
}
