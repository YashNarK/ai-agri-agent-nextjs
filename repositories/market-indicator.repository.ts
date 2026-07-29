// ============================================================
// repositories/market-indicator.repository.ts
// Macro market indicator access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export interface IndicatorSeriesFilter {
  names?: string[] | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  limit?: number;
}

export class MarketIndicatorRepository {
  /**
   * Full time series for one or more indicators, ascending by date so the
   * sparklines can plot them directly.
   */
  async findSeries({
    names,
    dateFrom,
    dateTo,
    limit = 2000,
  }: IndicatorSeriesFilter) {
    const prisma = await getPrisma();
    return prisma.market_indicators.findMany({
      where: {
        ...(names && names.length > 0 ? { indicator_name: { in: names } } : {}),
        ...(dateFrom || dateTo
          ? {
              indicator_date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ indicator_name: "asc" }, { indicator_date: "asc" }],
      take: limit,
    });
  }

  /** Distinct indicator names — populates the selector without a full scan. */
  async listNames() {
    const prisma = await getPrisma();
    const rows = await prisma.market_indicators.findMany({
      distinct: ["indicator_name"],
      select: { indicator_name: true, unit: true },
      orderBy: { indicator_name: "asc" },
    });
    return rows;
  }

  /** Latest value on/before `onOrBefore` for one named indicator. */
  async findLatestValue(name: string, onOrBefore: Date) {
    const prisma = await getPrisma();
    return prisma.market_indicators.findFirst({
      where: {
        indicator_name: name,
        indicator_date: { lte: onOrBefore },
      },
      orderBy: { indicator_date: "desc" },
      select: { indicator_value: true },
    });
  }

  /**
   * The latest row per indicator name.
   * The Python version pulled every row ordered by (name, date desc)
   * and de-duplicated in memory; DISTINCT ON does it in one pass.
   */
  async findLatestPerIndicator() {
    const prisma = await getPrisma();
    return prisma.$queryRaw<
      {
        indicator_name: string;
        indicator_value: unknown;
        unit: string | null;
        indicator_date: Date;
      }[]
    >`
      SELECT DISTINCT ON (indicator_name)
             indicator_name,
             indicator_value,
             unit,
             indicator_date
      FROM agricultural.market_indicators
      ORDER BY indicator_name, indicator_date DESC
    `;
  }
}
