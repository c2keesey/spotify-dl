/** Bounds for the "every N hours" schedule field. */
export const HOURS_MIN = 1;
export const HOURS_MAX = 23;

/**
 * Clamp the hourly-interval input to a valid cron interval. A cleared or garbage
 * number field yields 0 / NaN, which would otherwise reach the API as an invalid
 * zero-hour cron interval; this coerces anything non-finite to the minimum and
 * clamps the rest into [1, 23].
 */
export function clampHours(raw: number | string): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(n)) return HOURS_MIN;
  return Math.min(HOURS_MAX, Math.max(HOURS_MIN, Math.trunc(n)));
}
