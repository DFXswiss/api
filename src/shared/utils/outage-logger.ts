import { DfxLogger } from '../services/dfx-logger';
import { Util } from './util';

// Node system-error codes plus the one free-text phrase (socket hang up) that has no
// code. Deliberately no bare "timeout" — that also matches unrelated DB/query timeouts.
const CONNECTION_FAILURE_PATTERN =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE|socket hang up/i;

export function isConnectionFailure(e: Error): boolean {
  // Multi-address connects fail as AggregateError with an empty message; the system-error
  // code then sits only on the code field / member errors (logged as "AggregateError [ETIMEDOUT]").
  if (e instanceof AggregateError && e.errors.some((inner) => inner instanceof Error && isConnectionFailure(inner)))
    return true;

  return (
    CONNECTION_FAILURE_PATTERN.test(e.message ?? '') ||
    CONNECTION_FAILURE_PATTERN.test((e as NodeJS.ErrnoException).code ?? '')
  );
}

// Edge-triggered logging for an ongoing outage of a polled dependency: one ERROR when the
// outage starts, verbose repeats while it lasts, one INFO with duration on recovery. Turns
// a per-cycle outage flood into two signal lines without hiding the condition.
export class OutageLogger {
  private since?: Date;
  private failures = 0;

  constructor(
    private readonly logger: DfxLogger,
    private readonly subject: string,
  ) {}

  failure(e: Error): void {
    this.failures++;

    if (!this.since) {
      this.since = new Date();
      this.logger.error(`${this.subject} unreachable - suppressing repeats until recovery:`, e);
    } else {
      this.logger.verbose(`${this.subject} still unreachable (${this.failures} failed checks): ${e.message}`);
    }
  }

  recovered(): void {
    if (!this.since) return;

    const minutes = Math.round(Util.minutesDiff(this.since));
    this.logger.info(`${this.subject} recovered after ${minutes} min (${this.failures} failed checks)`);

    this.since = undefined;
    this.failures = 0;
  }
}
