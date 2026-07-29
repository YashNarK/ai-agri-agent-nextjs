// ============================================================
// components/charts/format.ts
// Shared value formatting, so axes and tooltips never disagree.
// ============================================================

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const decimal = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

export const formatUsd = (value: number) => usd.format(value);
export const formatUsdPrecise = (value: number) => usdPrecise.format(value);
export const formatCompact = (value: number) => compact.format(value);
export const formatDecimal = (value: number) => decimal.format(value);

export const formatPercent = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const monthYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const fullDate = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * All date columns here are timezone-free Postgres `date` values
 * serialised as YYYY-MM-DD. Parsing and formatting in UTC keeps a value
 * from sliding a day depending on the viewer's locale.
 */
export const parseIsoDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const formatMonthYear = (date: Date) => monthYear.format(date);
export const formatFullDate = (date: Date) => fullDate.format(date);
