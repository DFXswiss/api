/**
 * Returns the bucket size (minutes) for DB-side sampling of FinancialDataLog rows when the caller
 * did not request a daily sample.
 *
 * - `null`            → no bucketing, return every row (covers the 24h live view, ~1440 rows)
 * - positive integer  → 1 row per N-minute bucket (covers 3D/week ranges to keep payloads small)
 *
 * The cron writes a new row every minute, so without bucketing a 3-day range returns ~4320 rows.
 * A 5-minute bucket compresses that to ~864 rows without losing visible detail at chart resolution.
 */
export function getSampleIntervalMinutes(from?: Date, dailySample?: boolean): number | null {
  if (dailySample) return null;
  if (!from) return null;

  const rangeHours = (Date.now() - from.getTime()) / (1000 * 60 * 60);

  if (rangeHours <= 26) return null; // 24h live view: full resolution
  if (rangeHours <= 24 * 7) return 5; // 3 days, 1 week: 5-minute buckets

  // Beyond 1 week without dailySample we keep per-minute resolution; callers typically pass
  // dailySample=true for longer ranges, but we don't want to drop data silently here.
  return null;
}
