import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config, CronRole } from 'src/config/config';
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
 * Renew at a third of the lease.
 *
 * The timer below re-arms only once the previous attempt has settled, so the attempts fall at 20 s
 * and then 20 s after each answer — never earlier, and later whenever the database is slow. One
 * failed renewal therefore still leaves a further attempt with roughly 20 s to spare; two do not,
 * because the third attempt starts at 60 s at the earliest, which is the moment the claim lapses.
 * The margin this buys is one lost renewal, not two.
 */
const RENEWAL_INTERVAL_MS = (LEASE_TTL_SECONDS / 3) * 1000;

/**
 * How long shutdown waits for jobs that are still running. See `shutdown`.
 *
 * Short on purpose: it is a handover courtesy, not a completion guarantee. Every process pays it
 * on every deployment, and `main.ts` exits as soon as the wait ends, whether or not the jobs it
 * waited for are done.
 */
const SHUTDOWN_GRACE_MS = 10 * 1000;

/**
 * A lease on a scheduled job: the claim a process takes in the database before it starts one.
 *
 * `LockClass` keeps its state in a field of a process-local object. That was enough while the API
 * ran as one process; it cannot see a second one. Since the HTTP process and the worker are split
 * apart, "exactly one process runs this job" rests on configuration, a runbook sentence and an
 * alert — and that alert reports a WRONG ROLE, not a double run: a role that both processes can
 * see is not one the logs distinguish. For a path that moves money, an assumption checked from
 * the outside is the second-best answer, so this adds a layer underneath it.
 *
 * A layer, not a guarantee — read "What it does not do" below before relying on this. A job runs
 * once because the deployment runs one worker and because the job tolerates being run again; what
 * this contributes is that a second process has to take the claim before it may START the job, so
 * for as long as the holder keeps renewing, a wrongly configured second process does not start it
 * at all. It sits on top of those two properties and replaces neither.
 *
 * The lease is claimed per job name, and only one owner can hold it. It carries an expiry rather
 * than a lock held on a connection: a connection-bound `pg_advisory_lock` would occupy one pooled
 * connection for the whole runtime of the job, and 67 of the jobs declare a timeout measured in
 * minutes. That is a real risk to a connection pool sized by `SQL_POOL_MAX`. An expiring row costs
 * one short query to take, one to extend, one to release.
 *
 * **What it does not do.** It does not bound how long two processes can run the same job at once.
 * If the holder stops renewing while it is still working — an unreachable database, an event loop
 * blocked past the expiry — the claim lapses and a second process may start the same job. The run
 * that lost the claim is neither stopped nor paused: `keepAlive` logs the loss at error level and
 * goes on renewing, and the run continues to its own end, which for a job declaring `timeout:
 * 7200` is up to two hours. Nothing here can shorten that. A running function cannot be aborted
 * from the outside in JavaScript, and a cooperative check would have to sit at every write inside
 * every job — the same work as carrying the claim into every write, which is the fencing this
 * does not attempt.
 *
 * What it does bound is the waiting, which is what it was built for. A claim left behind by a
 * process that can no longer speak for itself — SIGKILL, an OOM kill, a lost machine — keeps the
 * job from running anywhere for at most `LEASE_TTL_SECONDS` past its last renewal instead of
 * until someone intervenes, and that same span is the longest a second process has to wait before
 * it may take the job over.
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
   *
   * Every operation that reaches the table clears it, not just `acquire`: the heartbeat reports
   * this as a STATE, and a process whose jobs are long-running renews for minutes at a time
   * without acquiring anything. Healing on `acquire` alone would leave such a process reporting a
   * failure it has already recovered from until its next claim.
   */
  private healthy = true;

  /**
   * Set once shutdown has begun, so no further lease is taken. See `shutdown`.
   */
  private shuttingDown = false;

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
      this.recordSuccess();
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

    this.recordSuccess();

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

    this.recordSuccess();

    return affected > 0;
  }

  /**
   * Releases the lease. Scoped to this owner so a run that already lost the lease cannot delete
   * the row a different process is now holding.
   */
  async release(job: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM "cron_lease" WHERE "name" = $1 AND "owner" = $2`, [job, this.owner]);

    this.recordSuccess();
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
   * runs it, losing the race means that effect did not happen where it was needed — which is what
   * `CronScope.API` describes. Nothing else can tell the two apart, so the caller says which it is.
   */
  async run(job: string, task: () => Promise<void>, reportContention = false): Promise<void> {
    // Once shutdown has begun, starting a run is worse than skipping it: `shutdown` waits on the
    // jobs it found when it started, and the process exits when that wait ends. A run started
    // afterwards is not in that set, so it would be cut off mid-way — before the `finally` below
    // releases its lease, and, more importantly, part-way through whatever it was doing.
    if (this.shuttingDown) return;

    let acquired: boolean;
    try {
      acquired = await this.acquire(job);
    } catch (e) {
      this.recordFailure(e);

      // Unreachable table, missing grant, database down. What happens next depends on the role,
      // and the difference matters more than it looks.
      //
      // Under `all` the deployment runs ONE process — the same shape the API had before this
      // branch existed, when no lease was involved at all. Skipping there would make an
      // unreachable lease table STRICTLY WORSE than not having one: 123 of 139 jobs would stop,
      // payouts included, and between the rollout of this application version and the rollout of
      // the alert that reads the heartbeat there is no rule that would say so. So the job runs.
      // Two processes on `all` would then run it twice — exactly as they would have before, and
      // the `role-mismatch` rule reports that pair once it exists.
      //
      // Under `api` or `worker` the lease is the only thing keeping the job to one process, and
      // its absence is not recoverable by running anyway. There the skip stands, and the
      // heartbeat carries the reason out.
      if (Config.cronRole !== CronRole.ALL) {
        this.logger.error(`Skipping ${job}: could not reach the lease table`, e);
        return;
      }

      this.logger.error(
        `Running ${job} WITHOUT a lease: could not reach the lease table, and CRON_ROLE=all runs ` +
          `one process — not running it would be worse than the single-process setup this ` +
          `replaces`,
        e,
      );

      return task();
    }

    if (!acquired) {
      if (reportContention)
        this.logger.error(
          `Skipped ${job}: another process holds the lease. This job only has an effect in the ` +
            `process that runs it, so that effect did not happen here`,
        );

      return;
    }

    // Claiming the lease is a round trip, and shutdown can begin during it. Hand the claim straight
    // back rather than start under it, so the successor does not sit out the expiry for a job that
    // never ran.
    //
    // This is best effort, not a guarantee: a job still inside its claim is not in `inFlight` yet,
    // so `shutdown` does not wait for it, and the process can exit before the release below runs.
    // What then remains is a claim nobody holds — it lapses within the TTL like any other, which
    // is the bound that always applies. The release only ever shortens that wait.
    if (this.shuttingDown) {
      await this.release(job).catch(() => undefined);
      return;
    }

    const renewal = this.keepAlive(job);

    const run = (async () => {
      try {
        await task();
      } finally {
        renewal.stop();
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
   * over faster, but the job keeps running until this process exits, which `main.ts` does once the
   * wait below ends — so up to `SHUTDOWN_GRACE_MS` after the signal. A successor claiming the
   * freed lease inside that window would run the same money-moving job alongside it, which is the
   * outcome this mechanism exists to make rare, so it is not traded for a faster handover.
   *
   * What is still running after the wait therefore keeps its lease, which lapses within
   * `LEASE_TTL_SECONDS` of the last renewal. The renewal timers deliberately keep going meanwhile:
   * they hold the claim for as long as this process is alive to renew it.
   *
   * Bounded on every path: the only thing awaited is a race against `SHUTDOWN_GRACE_MS`, so a
   * database that has stopped answering cannot turn this into a process that never exits.
   */
  async shutdown(): Promise<void> {
    // Before the snapshot below, not after: the wait covers the jobs that were running when it was
    // taken, and the process exits once it ends. A job that started meanwhile would not be waited
    // for and would be cut off part-way through — see the guard at the top of `run`.
    this.shuttingDown = true;

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

  /**
   * Renews the claim for `job` while it runs, with one renewal outstanding at a time.
   *
   * A fixed interval fires whether or not the previous renewal has come back, and a database that
   * answers slowly is exactly the situation this has to survive: the attempts pile up, each one
   * occupying a pooled connection, and an older answer can land after a newer one. Re-arming only
   * once the previous attempt has settled bounds that to a single outstanding statement. The price
   * is that the renewals drift later by however long the database takes to answer, and the TTL —
   * three times the interval — leaves room for one such answer to be slow or lost, not for a
   * database that is slow to every one of them. See RENEWAL_INTERVAL_MS.
   *
   * Losing the claim does not stop the run. There is nothing here that could stop it, and the
   * timer deliberately keeps going: this process holds the claim for as long as it can renew it.
   */
  private keepAlive(job: string): { stop: () => void } {
    let stopped = false;
    let timer: NodeJS.Timeout;

    const schedule = (): void => {
      // Unref'd: a pending timer must never hold the process open on shutdown.
      timer = setTimeout(async () => {
        try {
          const stillOurs = await this.renew(job);
          if (!stillOurs) this.logger.error(`Lost the lease for ${job} while it was still running`);
        } catch (e) {
          this.recordFailure(e);
          this.logger.error(`Could not extend the lease for ${job}`, e);
        }

        if (!stopped) schedule();
      }, RENEWAL_INTERVAL_MS);
      timer.unref();
    };

    schedule();

    return {
      stop: () => {
        stopped = true;
        clearTimeout(timer);
      },
    };
  }

  private recordSuccess(): void {
    this.healthy = true;
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
