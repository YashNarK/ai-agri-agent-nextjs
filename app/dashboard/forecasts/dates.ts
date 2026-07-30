// ============================================================
// app/dashboard/forecasts/dates.ts
//
// Date bounds for the forecast form, shared by the page (which renders
// them) and the action (which enforces them).
//
// A separate module because every export of a "use server" file must be
// an async server action — a plain helper living there is a build
// error, not a style preference.
//
// Everything is UTC. `target_date` is a timezone-free Postgres `date`
// and the model encodes month cyclically, so a local-time boundary
// would put "tomorrow" on the wrong day for half the world.
// ============================================================

const DAY_MS = 86_400_000;

/** Today in UTC as YYYY-MM-DD — the boundary a target date must beat. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `days` after today, as YYYY-MM-DD. */
export function isoDaysFromToday(days: number): string {
  const base = Date.parse(`${todayIso()}T00:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}
