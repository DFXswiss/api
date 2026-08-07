import { DfxLogger } from './shared/services/dfx-logger';

/**
 * Handles a rejected bootstrap promise: logs a clear "Bootstrap failed" line and exits 1.
 * Kept out of `main.ts` so it can be unit-tested without importing the Nest bootstrap path.
 */
export function handleBootstrapFailure(error: unknown): void {
  const logger = new DfxLogger('Bootstrap');
  logger.error('Bootstrap failed:', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
}
