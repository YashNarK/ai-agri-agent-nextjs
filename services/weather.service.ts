// ============================================================
// services/weather.service.ts
// Weather and drought observations for a region
// ============================================================

import type { WeatherResponse, WeatherSchema } from "@/lib/schemas";
import { toDateString, toNumberOrNull } from "@/lib/serialize";
import type { WeatherRepository } from "@/repositories/weather.repository";
import type { RegionsService } from "@/services/regions.service";

type WeatherRow = Awaited<ReturnType<WeatherRepository["findRange"]>>[number];

export function toWeatherSchema(row: WeatherRow): WeatherSchema {
  return {
    id: Number(row.id),
    region_id: row.region_id,
    weather_date: toDateString(row.weather_date),
    temp_max_c: toNumberOrNull(row.temp_max_c),
    temp_min_c: toNumberOrNull(row.temp_min_c),
    temp_avg_c: toNumberOrNull(row.temp_avg_c),
    rainfall_mm: toNumberOrNull(row.rainfall_mm),
    humidity_pct: toNumberOrNull(row.humidity_pct),
    wind_speed_kmh: toNumberOrNull(row.wind_speed_kmh),
    solar_radiation: toNumberOrNull(row.solar_radiation),
    drought_index: toNumberOrNull(row.drought_index),
  };
}

export interface WeatherQuery {
  regionCode: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
}

export class WeatherService {
  constructor(
    private readonly weatherRepo: WeatherRepository,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * Observations for a region over a date range. Unknown region → 404;
   * a known region with no rows in the window → an empty list, matching
   * how the price endpoint behaves.
   */
  async getWeather({
    regionCode,
    dateFrom,
    dateTo,
    limit = 365,
  }: WeatherQuery): Promise<WeatherResponse> {
    const region = await this.regionsService.requireRegionByCode(regionCode);

    const rows = await this.weatherRepo.findRange({
      regionId: region.id,
      dateFrom,
      dateTo,
      limit,
    });

    return {
      region: region.name,
      region_code: region.code,
      observations: rows.map(toWeatherSchema),
      total: rows.length,
    };
  }
}
