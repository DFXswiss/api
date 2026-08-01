import { DfxLogger } from './shared/services/dfx-logger';

/**
 * Fixed mid-month noon-UTC anchors for seasonal offset sampling.
 * Mid-month avoids DST transition days; a fixed year keeps the check deterministic.
 * Both must be 0 for a process that is UTC (or permanently zero-offset, e.g. Atlantic/Reykjavik)
 * year-round — a single `new Date().getTimezoneOffset()` would accept Europe/London in winter.
 */
const JANUARY_OFFSET_ANCHOR = new Date(Date.UTC(2024, 0, 15, 12, 0, 0));
const JULY_OFFSET_ANCHOR = new Date(Date.UTC(2024, 6, 15, 12, 0, 0));

export type CheckProcessTimezoneDeps = {
  logger?: DfxLogger;
  /**
   * Override for tests; production uses `Date#getTimezoneOffset` on fixed Jan/Jul anchors.
   * Takes the date so tests can simulate seasonal offsets (e.g. London winter vs summer).
   */
  getTimezoneOffset?: (date: Date) => number;
  /** Override for tests; production uses Intl resolved zone name. */
  getTimeZoneName?: () => string;
};

/**
 * Logs the process timezone at boot. Warns when the Node process is not UTC year-round;
 * never throws — deploy start commands may set `TZ` outside this repo, and a hard abort
 * would block deploys without a confirmed host-side guarantee.
 *
 * Sibling of `assertValidStorageCombo` (config.ts) for runtime prerequisites, but advisory
 * only: columns like `created` are `timestamp without time zone` and the Postgres driver
 * serializes JS `Date` in the process-local wall-clock.
 *
 * Must run before NestFactory.create — TypeORM connects during app creation.
 *
 * Offset is checked at January and July anchors, not "today": zones with seasonal
 * UTC-offset (Europe/London in winter) must not look fine just because boot landed in
 * the zero-offset half of the year. For serialization only the offset matters —
 * Atlantic/Reykjavik (permanently 0) is treated as OK.
 */
export function checkProcessTimezone(deps: CheckProcessTimezoneDeps = {}): void {
  const getOffset = deps.getTimezoneOffset ?? ((date: Date) => date.getTimezoneOffset());
  const januaryOffset = getOffset(JANUARY_OFFSET_ANCHOR);
  const julyOffset = getOffset(JULY_OFFSET_ANCHOR);
  // The 'unknown' fallback feeds the diagnostic message only — never a decision. The offset
  // already decides; Intl can return undefined on exotic ICU builds and must not mask that.
  const timeZone = (deps.getTimeZoneName ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone))() ?? 'unknown';
  const logger = deps.logger ?? new DfxLogger('ProcessTimezone');

  if (januaryOffset === 0 && julyOffset === 0) {
    logger.info(`Process timezone OK: "${timeZone}" (getTimezoneOffset january=${januaryOffset}, july=${julyOffset}).`);
    return;
  }

  logger.warn(
    `Process timezone must be UTC: columns like \`created\` are timestamp without time zone and the ` +
      `Postgres driver serializes JS Date in the process-local wall-clock (Postgres then drops the offset). ` +
      `Found timezone "${timeZone}" (getTimezoneOffset january=${januaryOffset}, july=${julyOffset}). ` +
      `Set ENV TZ=UTC.`,
  );
}
