import { Environment, GetConfig } from './config/config';
import { DfxLogger } from './shared/services/dfx-logger';

export type AssertUtcProcessTimezoneDeps = {
  /** Override for tests; production uses GetConfig().environment (boot-safe). */
  environment?: Environment;
  logger?: DfxLogger;
  /** Override for tests; production uses new Date().getTimezoneOffset(). */
  getTimezoneOffset?: () => number;
  /** Override for tests; production uses Intl resolved zone name. */
  getTimeZoneName?: () => string;
};

/**
 * Ensures the Node process runs in UTC before any DB work.
 *
 * Fail-loud sibling of `assertValidStorageCombo` (config.ts): invalid runtime
 * prerequisites throw with a concrete diagnosis rather than silently continuing.
 * Deployed environments throw; LOC only warns so developers outside UTC can
 * still start the app.
 *
 * Must run before NestFactory.create — TypeORM connects during app creation.
 * Uses GetConfig() rather than the Config singleton for the same boot-safety
 * reason as `createStorageService` (storage.factory.ts): KYC/support (and this
 * assert) may run before ConfigService has assigned the `Config` export, so
 * they read a fresh Configuration from process.env instead.
 */
export function assertUtcProcessTimezone(deps: AssertUtcProcessTimezoneDeps = {}): void {
  const offset = (deps.getTimezoneOffset ?? (() => new Date().getTimezoneOffset()))();
  if (offset === 0) return;

  const timeZone = (deps.getTimeZoneName ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone))() ?? 'unknown';
  const environment = deps.environment ?? GetConfig().environment;
  const logger = deps.logger ?? new DfxLogger('ProcessTimezone');

  const message =
    `Process timezone must be UTC: columns like \`created\` are timestamp without time zone and the ` +
    `Postgres driver serializes JS Date in the process-local wall-clock (Postgres then drops the offset). ` +
    `Found timezone "${timeZone}" (getTimezoneOffset=${offset}). Set ENV TZ=UTC.`;

  if (environment === Environment.LOC) {
    logger.warn(message);
    return;
  }

  throw new Error(message);
}
