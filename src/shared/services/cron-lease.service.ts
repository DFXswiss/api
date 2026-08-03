import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config } from 'src/config/config';
import { DataSource } from 'typeorm';
import { DfxLogger } from './dfx-logger';

/**
 * How long a claim stays valid without being renewed.
 *
 * Deliberately short, and deliberately unrelated to how long the job it guards may run. A lease
 * expiry is not a job timeout: its only purpose is to bound how long a claim outlives a process
 * that can no longer speak for itself — SIGKILL, an OOM kill, a lost machine. In each of those the
 * row stays behind until it expires, and for that window the job runs nowhere.
 *
 * Deriving the expiry from the job's own timeout got that backwards. A timeout answers "how long
 * may this run take", which says nothing about how long a stale claim should survive its owner,
 * and it made the outage longest for exactly the jobs that declare the longest timeouts. One
 * minute is long enough for the renewal below to carry a healthy run across a slow query or a
 * brief connection hiccup, and short enough that the worst case is a minute of one job not
 * running.
 */
const LEASE_TTL_SECONDS = 60;

/**
 * Renew at a third of the lease, so two consecutive failed renewals still leave a full attempt
 * before the claim lapses.
 */
const RENEWAL_INTERVAL_MS = (LEASE_TTL_SECONDS / 3) * 1000;

/**
 * How long shutdown waits for jobs that are still running. See `shutdown`.
 *
 * Short on purpose: it is a handover courtesy, not a completion guarantee. Every process pays it
 * on every deployment, and the container's own stop grace period ends the process regardless.
 */
const SHUTDOWN_GRACE_MS = 10 * 1000;

/**
 * A lease on a scheduled job, held in the database for as long as the job runs.
 *
 * `LockClass` keeps its state in a field of a process-local object. That was enough while the API
 * ran as one process; it cannot see a second one. Since the HTTP process and the worker are split
 * apart, "exactly one process runs this job" rests on configuration, a runbook sentence and an
 * alert that *reports* a double run after the fact. For a path that moves money that is the
 * second-best answer, so this makes it structural.
 *
 * The lease is claimed per job name, and only one owner can hold it. It carries an expiry rather
 * than a lock held on a connection: a connection-bound `pg_advisory_lock` would occupy one pooled
 * connection for the whole runtime of the job, and 67 of the jobs declare a timeout measured in
 * minutes. Against `SQL_POOL_MAX=40` that is a real risk to the connection budget. An expiring row
 * costs one short query to take, one to extend, one to release.
 *
 * **What it does not do.** If the database becomes unreachable while a job runs, the lease cannot
 * be extended and eventually expires — a second process may then start the same job while the
 * first is still working. Preventing that outright would require every write inside every job to
 * carry the lease token, which this does not attempt. What it does is turn an unbounded window
 * ("until a human reads the alert") into a bounded one (`LEASE_TTL_SECONDS`). A lost lease is
 * logged at error level, because it means the run that is still going has no claim to the job any
 * more.
 */
@Injectable()
export class CronLeaseService implements OnModuleInit {
  private readonly logger = new DfxLogger(CronLeaseService);

  private ownerId?: string;

  /**
   * The runs this process currently holds a lease for, by job name.
   *
   * Kept so shutdown knows what is still outstanding. The stored promise has its rejection already
   * absorbed: the job's own error belongs to its caller, and a second consumer of the same
   * rejection here would surface as an unhandled one.
   */
  private readonly inFlight = new Map<string, Promise<void>>();

  /**
   * Whether the last lease operation reached the table. Sticky until one succeeds, so a role whose
   * jobs all sit out still reports the state rather than only the tick that first hit it.
   */
  private healthy = true;

  /** Lease operations that failed since the role heartbeat last read them; see `takeFailures`. */
  private failures = 0;
  private lastFailure?: string;

  /**
   * Identifies THIS process for the lifetime of the process. The role makes a stray row readable
   * for an operator; the random part is what actually distinguishes two processes of the same
   * role — a restarted container must not be able to renew a lease that its predecessor took.
   *
   * Resolved on first use rather than in a field initializer: `Config` does not exist until
   * `ConfigService` has been constructed, and a provider built before it would take down the boot.
   */
  private get owner(): string {
    return (this.ownerId ??= `${Config.cronRole}:${randomUUID()}`);
  }

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reads the lease table once, so a process that cannot use it says so at start-up.
   *
   * Without the table — a process started before the migration ran, a revoked grant, a database
   * that is not there yet — every worker- and api-scoped job fails its claim and is skipped. That
   * is the correct behaviour, and CONTRIBUTING asks for exactly it where the alternative is
   * proceeding on an unverified assumption. The problem it left behind is a reporting one: the
   * skip is indistinguishable from a job that had nothing to do, and the role heartbeat is scoped
   * `both`, so it is exempt from the lease and keeps reporting a healthy process.
   *
   * This does not take the boot down. A crash loop here would be loud, but it would also be
   * self-inflicted during the very rollout that introduces the table: the migration ships with the
   * process that runs migrations, and the other one would restart against a database that is
   * correct a minute later. Reporting is what was missing, so reporting is what this adds — here,
   * and continuously through `takeFailures`, because a boot line scrolls out of an alert window
   * and says nothing about a table that disappeared afterwards.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`SELECT 1 FROM "cron_lease" LIMIT 1`);
    } catch (e) {
      this.recordFailure(e);
      this.logger.error(
        'The cron lease table cannot be read: every worker- and api-scoped job will be skipped on every tick',
        e,
      );
    }
  }

  /**
   * Claims the lease for `job`, or reports that someone else holds it.
   *
   * A single statement decides it: the insert either creates the row or takes it over from an
   * expired owner. Two processes racing here are serialised by the primary key, so exactly one of
   * them sees a returned row. Read the `WHERE` as "only if nobody is currently holding it" — an
   * unexpired row belonging to another process leaves the update out and returns nothing.
   */
  async acquire(job: string): Promise<boolean> {
    const claimed = await this.dataSource.query(
      `INSERT INTO "cron_lease" ("name", "owner", "acquired", "expires")
       VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
       ON CONFLICT ("name") DO UPDATE
         SET "owner" = EXCLUDED."owner", "acquired" = EXCLUDED."acquired", "expires" = EXCLUDED."expires"
         WHERE "cron_lease"."expires" <= now()
       RETURNING "owner"`,
      [job, this.owner, `${LEASE_TTL_SECONDS}`],
    );

    this.healthy = true;

    return claimed.length > 0;
  }

  /**
   * Pushes the expiry out while the job is still running. Returns false when this process is no
   * longer the owner — which means another process has taken the job over and this run should be
   * treated as having lost its claim.
   */
  async renew(job: string): Promise<boolean> {
    const [, affected] = await this.dataSource.query(
      `UPDATE "cron_lease"
       SET "expires" = now() + ($3 || ' seconds')::interval
       WHERE "name" = $1 AND "owner" = $2`,
      [job, this.owner, `${LEASE_TTL_SECONDS}`],
    );

    return affected > 0;
  }

  /**
   * Releases the lease. Scoped to this owner so a run that already lost the lease cannot delete
   * the row a different process is now holding.
   */
  async release(job: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM "cron_lease" WHERE "name" = $1 AND "owner" = $2`, [job, this.owner]);
  }

  /**
   * Runs `task` only if this process can claim the lease, and keeps the claim alive meanwhile.
   *
   * Failing to reach the database means NOT running: a job that moves money must not proceed on
   * the assumption that it is probably alone. The caller sees the same outcome as a job whose
   * lease is held elsewhere — it simply does not run this cycle and tries again on the next.
   *
   * `reportContention` marks jobs for which losing the race is not a normal outcome. For a worker
   * job it is: the other worker holds the lease and is doing the work, and the result lands in the
   * database where everyone can see it. For a job whose effect is confined to the process that
   * runs it, losing the race means that effect did not happen where it was needed — see
   * PaymentCronService. Nothing else can tell the two apart, so the caller says which it is.
   */
  async run(job: string, task: () => Promise<void>, reportContention = false): Promise<void> {
    let acquired: boolean;
    try {
      acquired = await this.acquire(job);
    } catch (e) {
      this.recordFailure(e);
      this.logger.error(`Skipping ${job}: could not reach the lease table`, e);
      return;
    }

    if (!acquired) {
      if (reportContention)
        this.logger.error(
          `Skipped ${job}: another process holds the lease. This job only has an effect in the ` +
            `process that runs it, so that effect did not happen here`,
        );

      return;
    }

    // Unref'd: a pending timer must never hold the process open on shutdown.
    const renewal = setInterval(() => {
      void this.renew(job)
        .then((stillOurs) => {
          if (!stillOurs) this.logger.error(`Lost the lease for ${job} while it was still running`);
        })
        .catch((e) => {
          this.recordFailure(e);
          this.logger.error(`Could not extend the lease for ${job}`, e);
        });
    }, RENEWAL_INTERVAL_MS);
    renewal.unref();

    const run = (async () => {
      try {
        await task();
      } finally {
        clearInterval(renewal);
        await this.release(job).catch((e) => {
          this.recordFailure(e);
          this.logger.error(`Could not release the lease for ${job}`, e);
        });
        this.inFlight.delete(job);
      }
    })();

    this.inFlight.set(
      job,
      run.catch(() => undefined),
    );

    return run;
  }

  /**
   * Waits for the jobs this process is still running, so their normal release path can hand the
   * lease over to the successor instead of leaving it to expire.
   *
   * Called from a SIGTERM/SIGINT handler in `main.ts`, deliberately NOT through Nest's
   * `enableShutdownHooks`. That switch is global: it would also start running nine
   * `onModuleDestroy` hooks that have never run in this application, because nothing ever asked
   * for a shutdown hook. Nest runs those BEFORE this one, and they empty the strategy registries
   * that PayIn, PayOut and DEX jobs resolve from. Combined with the wait below — which is the
   * whole point here, keeping in-flight jobs alive LONGER into the shutdown — that would let a
   * running payout fail on an emptied registry instead of simply being cut off. Handing over a
   * lease is not worth activating that.
   *
   * A lease is NOT taken away from a job that is still working. Releasing on SIGTERM would hand
   * over faster, but the job keeps running until the container's stop grace period ends it —
   * `dfx-api-worker` is configured to allow two minutes — and a successor claiming the freed lease
   * inside that window would run the same money-moving job alongside it. That is the outcome this
   * whole mechanism exists to prevent, so it is not traded for a faster handover.
   *
   * What is still running after the wait therefore keeps its lease, which lapses within
   * `LEASE_TTL_SECONDS` of the last renewal. The renewal timers deliberately keep going meanwhile:
   * they hold the claim for as long as this process is alive to renew it.
   *
   * Bounded on every path: the only thing awaited is a race against `SHUTDOWN_GRACE_MS`, so a
   * database that has stopped answering cannot turn this into a process that never exits.
   */
  async shutdown(): Promise<void> {
    const running = [...this.inFlight.values()];
    if (!running.length) return;

    this.logger.info(`Shutting down: waiting up to ${SHUTDOWN_GRACE_MS / 1000}s for ${running.length} running job(s)`);

    await Promise.race([Promise.all(running), this.shutdownGrace()]);

    const stranded = [...this.inFlight.keys()];
    if (stranded.length)
      this.logger.warn(
        `Shutting down with ${stranded.length} job(s) still running (${stranded.join(', ')}); ` +
          `their leases stay held and lapse within ${LEASE_TTL_SECONDS}s`,
      );
  }

  /**
   * The state of the lease layer, for the role heartbeat to report.
   *
   * Read rather than pushed: a lease that cannot reach its table stops every worker- and
   * api-scoped job, and no other line says so — the jobs simply do not run. `healthy` stays false
   * until an operation succeeds, so a role whose jobs are all sitting out keeps reporting it
   * instead of falling quiet after the first window. The counter is per window; the last message
   * is not, so an unhealthy report always names something.
   */
  takeFailures(): { healthy: boolean; count: number; last?: string } {
    const taken = { healthy: this.healthy, count: this.failures, last: this.lastFailure };

    this.failures = 0;

    return taken;
  }

  private recordFailure(e: unknown): void {
    this.failures++;
    this.lastFailure = e instanceof Error ? e.message : String(e);
    this.healthy = false;
  }

  private shutdownGrace(): Promise<void> {
    // Unref'd so winning the race above does not keep the process alive for the rest of the grace.
    return new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref());
  }
}
