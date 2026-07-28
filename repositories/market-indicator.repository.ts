// ============================================================
// repositories/market-indicator.repository.ts
// Macro market indicator access
// ============================================================

import { getPrisma } from "@/lib/prisma";

export class MarketIndicatorRepository {
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
