/**
 * Errors the process deliberately survives instead of exiting on.
 *
 * The Spark SDK can raise process-level failures whose constructor name contains
 * "Spark" or whose message contains "Channel has been shut down". SparkClient.call()
 * already treats the latter as an expected operating condition and reinitializes the
 * wallet when it sees it. Applying the same policy at the process boundary keeps the
 * process alive when the same failure escapes outside call() (for example during
 * client boot without network connectivity) as either an uncaught exception or an
 * unhandled promise rejection. Unrelated process errors are not tolerated.
 */
export function isToleratedProcessError(error: unknown): boolean {
  try {
    const constructorName = getConstructorName(error);
    if (constructorName.includes('Spark')) {
      return true;
    }

    const message = getMessage(error);
    return message.includes('Channel has been shut down');
  } catch {
    // Rejection/exception reasons can be arbitrary values, including objects with
    // throwing getters. Never let the policy check itself crash the process.
    return false;
  }
}

function getConstructorName(error: unknown): string {
  if (error === null || error === undefined) {
    return '';
  }

  const name = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === 'string' ? name : '';
}

function getMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return '';
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}
