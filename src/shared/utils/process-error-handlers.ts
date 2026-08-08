import { DfxLogger } from '../services/dfx-logger';
import { isToleratedProcessError } from './process-error-policy';
import { safeLogError } from './safe-log';

export interface ProcessErrorHandlerDeps {
  logger: DfxLogger;
  exit: () => void;
}

/** Decides whether an uncaught exception keeps the process alive, and logs it either way. */
export function handleUncaughtException(error: unknown, deps: ProcessErrorHandlerDeps): void {
  // Node's uncaughtException always delivers an Error; the parameter is typed as unknown so
  // tests can exercise hostile and non-Error values without starting the Nest app.
  const loggable = error as Error;

  if (isToleratedProcessError(error)) {
    safeLogError(deps.logger, 'Spark SDK uncaught exception (process kept alive):', loggable);
    return;
  }

  // exit() must run even if logging throws; safeLogError already swallows logger failures,
  // but try/finally keeps the shutdown decision independent of the log path.
  try {
    safeLogError(deps.logger, 'Uncaught exception, shutting down:', loggable);
  } finally {
    deps.exit();
  }
}

/** Same decision for an unhandled promise rejection, whose reason can be any value at all. */
export function handleUnhandledRejection(reason: unknown, deps: ProcessErrorHandlerDeps): void {
  // A rejection can carry any value, not just an Error. Normalize for the logger, but test the
  // policy against the original value - isToleratedProcessError inspects the constructor name.
  //
  // `instanceof` is guarded because it is not safe on an arbitrary value either: it consults the
  // prototype chain, and a Proxy with a throwing getPrototypeOf trap makes the expression itself
  // throw. Unguarded, that throw happens before the policy is ever consulted, and a rejection the
  // policy would have tolerated ends up killing the process anyway.
  const error = toLoggableError(reason);

  if (isToleratedProcessError(reason)) {
    safeLogError(deps.logger, 'Spark SDK unhandled rejection (process kept alive):', error);
    return;
  }

  try {
    safeLogError(deps.logger, 'Unhandled rejection, shutting down:', error);
  } finally {
    deps.exit();
  }
}

function safeStringify(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '<unstringifiable rejection reason>';
  }
}

function toLoggableError(reason: unknown): Error {
  try {
    if (reason instanceof Error) return reason;
  } catch {
    // A hostile prototype trap: fall through and wrap it like any other non-Error value.
  }
  return new Error(`Non-Error rejection: ${safeStringify(reason)}`);
}
