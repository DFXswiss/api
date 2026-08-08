import { DfxLogger } from '../services/dfx-logger';

/**
 * Wraps logger.error(message, error) in try/catch. On failure (e.g. a hostile Proxy
 * with a throwing getter on stack/message/name), falls back to logging only the
 * message string, without touching any property of the original error object again.
 */
export function safeLogError(logger: DfxLogger, message: string, error: Error): void {
  try {
    logger.error(message, error);
  } catch {
    try {
      // Do not pass `error` again: any property access on a hostile Proxy may throw.
      logger.error(`${message} (original error could not be logged)`);
    } catch {
      // The logger itself is broken. Losing the line is bad; throwing out of a process-level
      // handler that has already decided to keep the process alive would be worse.
    }
  }
}
