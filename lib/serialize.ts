// ============================================================
// lib/serialize.ts
//
// Conversion helpers for values Prisma returns that JSON cannot
// represent directly.
//
// Pydantic did this implicitly (`float | None`, `date`); in
// TypeScript the Postgres `numeric` columns arrive as Prisma
// Decimal objects and `bigint` ids as native BigInt — both of
// which make JSON.stringify throw or emit `{"s":1,...}` noise.
// Every schema mapper below funnels through these.
// ============================================================

/** Prisma Decimal / bigint / number → number, preserving null. */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    throw new Error("toNumber received null/undefined");
  }
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value.toString());
}

/** Nullable variant — null and undefined both collapse to null. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toNumber(value);
}

/** Date → `YYYY-MM-DD`, matching pydantic's `date` serialisation. */
export function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Date → ISO 8601, matching pydantic's `datetime` serialisation. */
export function toDateTimeString(value: Date): string {
  return value.toISOString();
}

/**
 * Parses a `YYYY-MM-DD` string into a UTC Date.
 * Postgres `date` columns are timezone-free; going through UTC
 * keeps a date from sliding a day depending on server locale.
 */
export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid date '${value}'. Use YYYY-MM-DD.`);
  }
  const [, year, month, day] = match;
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date '${value}'. Use YYYY-MM-DD.`);
  }
  return parsed;
}
