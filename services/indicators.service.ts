// ============================================================
// services/indicators.service.ts
// Macro market indicators, shaped as plottable series
// ============================================================

import type { IndicatorResponse, IndicatorSeries } from "@/lib/schemas";
import { toDateString, toNumber } from "@/lib/serialize";
import type { MarketIndicatorRepository } from "@/repositories/market-indicator.repository";

export interface IndicatorQuery {
  names?: string[] | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
}

export class IndicatorsService {
  constructor(private readonly indicatorRepo: MarketIndicatorRepository) {}

  /**
   * Returns one entry per indicator with its points nested, rather than a
   * flat row list. Charts draw one path per series, so grouping here means
   * every consumer doesn't re-group it.
   */
  async getSeries({
    names,
    dateFrom,
    dateTo,
    limit,
  }: IndicatorQuery): Promise<IndicatorResponse> {
    const rows = await this.indicatorRepo.findSeries({
      names,
      dateFrom,
      dateTo,
      limit,
    });

    const grouped = new Map<string, IndicatorSeries>();
    for (const row of rows) {
      let series = grouped.get(row.indicator_name);
      if (!series) {
        series = {
          indicator_name: row.indicator_name,
          unit: row.unit,
          points: [],
        };
        grouped.set(row.indicator_name, series);
      }
      series.points.push({
        indicator_date: toDateString(row.indicator_date),
        indicator_value: toNumber(row.indicator_value),
      });
    }

    const series = [...grouped.values()];
    return {
      series,
      total: series.reduce((sum, s) => sum + s.points.length, 0),
    };
  }

  /** Available indicator names and units, for the selector. */
  async listNames(): Promise<{ indicator_name: string; unit: string | null }[]> {
    return this.indicatorRepo.listNames();
  }
}
