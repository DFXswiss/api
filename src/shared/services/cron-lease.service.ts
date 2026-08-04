import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config, CronRole } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
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
 * The timer below re-arms only once the previous attempt has settled, so at most one renewal is
 * ever outstanding. The interval is then measured from when an attempt STARTED, not from when it
 * answered: whatever the database has already spent comes off the next wait, and an answer that
 * took longer than the interval re-arms immediately.
 *
 * Measuring from the answer is what this replaced, and it spent the margin twice. An attempt fired
 * at 20 s whose answer arrived at 45 s put the next at 65 s — five seconds after the claim had
 * already lapsed, so a database slow enough to be worth surviving was the very thing that
 * guaranteed the loss. Attempts
 * now start every `max(interval, round trip)` instead of every `interval + round trip`: unchanged
 * while the database answers promptly, and no longer adding the latency on top of a wait that was
 * already sized to absorb it.
 *
 * It does not restore the three-attempts-per-TTL the interval was chosen for. Nothing can, once a
 * single round trip approaches the TTL — attempts then run back to back, one per round trip, and
 * each holds a pooled connection for the whole of it rather than for a fraction. That is the
 * deliberate trade: during an outage the claim is renewed as early as it possibly can be, at the
 * cost of a continuous rather than intermittent connection. The failure path re-arms the same way
 * and therefore has no backoff, which is the same trade seen from the other side.
 *
 * What is still not bounded is the round trip itself — there is no statement timeout on these
 * queries. A database slow to EVERY renewal cannot be renewed against at any cadence, and no
 * schedule fixes that; SLOW_RENEWAL_MS below exists to measure how close that case is. So the
 * expiry is still not read as a guarantee anywhere: a slow database remains the case where two
 * processes can end up running the same job, and "What it does not do" below says so.
 */
const RENEWAL_INTERVAL_MS = (LEASE_TTL_SECONDS / 3) * 1000;

/**
 * How long a renewal round trip may take before it is reported.
 *
 * The cadence above bounds when the next attempt STARTS, not how long an attempt takes, and the
 * claim goes unextended for the whole round trip either way: a renewal answering in 40 s leaves the
 * row 40 s closer to its expiry than the schedule suggests. Only a renewal that FAILED was ever
 * visible, so that span was reported as nothing at all.
 *
 * Five seconds is far outside the normal shape of the statement it times: a single-row UPDATE by
 * primary key. It is deliberately the same number a statement timeout on `renew` would use, so the
 * lines say which runs such a bound would have cut, and how far past it they went.
 *
 * Emitted as a high-water mark: only when an attempt is slower than anything this run has already
 * reported. Slowness PERSISTS, unlike a loss, so a line per attempt would emit some 360 of them for
 * a two-hour run and count run length rather than runs affected — while reporting only the FIRST
 * would freeze the number at 6 s for a run whose renewals then went to 300 s, and 300 s is what a
 * timeout would have to be sized against. The high-water mark costs a handful of lines per run and
 * keeps the largest. A run that reports none had every renewal inside the threshold.
 */
const SLOW_RENEWAL_MS = 5 * 1000;

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
 * that lost the claim is neither stopped nor paused: `keepAlive` logs the loss at error level once
 * and goes on renewing, and the run continues to its own end, which for a job declaring `timeout:
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
   * The runs this process has started and not yet finished, by the run's own owner string.
   *
   * Kept so shutdown knows what is still outstanding. The stored promise has its rejection already
   * absorbed: the job's own error belongs to its caller, and a second consumer of the same
   * rejection here would surface as an unhandled one.
   *
   * Keyed by RUN, not by job name, for the same reason the owner is: two runs of one job can
   * overlap in this process once `LockClass` has given up on the first. Under a shared key the
   * second would replace the first here, and whichever finished first would then delete the
   * entry of the other — leaving a run that `shutdown` neither waits for nor names.
   */
  private readonly inFlight = new Map<string, { job: string; run: Promise<void> }>();

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
  private get process(): string {
    return (this.ownerId ??= `${Config.cronRole}:${randomUUID()}`);
  }

  /**
   * Identifies ONE RUN. The owner written to the table is per run, not per process.
   *
   * Per process it would have been one identity for two runs that can overlap inside it. That
   * overlap is reachable: `LockClass` gives up on a job that outlives its declared timeout, so the
   * next tick starts a second run of the same job HERE while the first is still working. It cannot
   * take the claim while the first keeps renewing — but it can once a failed renewal has let the
   * claim lapse, and then both runs match `name + owner`. The first one to finish would delete the
   * row the second is holding, and a third process could start the job alongside it. Renewal has
   * the mirror problem: the old run would keep extending a claim it no longer has, and its
   * `stillOurs` check would come back true because it is comparing against itself.
   *
   * With one identity per run, both statements name the run that took the claim. The old run's
   * renewal returns false and says so, and its release matches nothing.
   */
  private newOwner(): string {
    return `${this.process}:${randomUUID()}`;
  }

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Reads the lease table once, so a process that cannot use it says so at start-up.
   *
   * Without the table — a process started before the migration ran, a revoked grant, a database
   * that is not there yet — every worker- and api-scoped job fails its claim. Under `api` or
   * `worker` it is then skipped, which is the correct behaviour and what CONTRIBUTING asks for
   * where the alternative is proceeding on an unverified assumption. Under `all` it runs anyway,
   * because that role is one process and stopping would be worse than the setup this replaces.
   *
   * Both outcomes have the same reporting problem, which is why this line exists: a skip is
   * indistinguishable from a job that had nothing to do, a claim-less run from a normal one, and
   * the role heartbeat is scoped `both` — exempt from the lease, and reporting a healthy process
   * in either case.
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
        Config.cronRole === CronRole.ALL
          ? 'The cron lease table cannot be read. CRON_ROLE=all runs one process, so worker- and ' +
              'api-scoped jobs keep running WITHOUT a claim rather than stopping — the same shape ' +
              'this deployment had before the lease existed. Fix the table before splitting the roles.'
          : 'The cron lease table cannot be read: every worker- and api-scoped job will be skipped ' + 'on every tick',
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
  async acquire(job: string, owner: string): Promise<boolean> {
    const claimed = await this.dataSource.query(
      `INSERT INTO "cron_lease" ("name", "owner", "acquired", "expires")
       VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
       ON CONFLICT ("name") DO UPDATE
         SET "owner" = EXCLUDED."owner", "acquired" = EXCLUDED."acquired", "expires" = EXCLUDED."expires"
         WHERE "cron_lease"."expires" <= now()
       RETURNING "owner"`,
      [job, owner, `${LEASE_TTL_SECONDS}`],
    );

    this.recordSuccess();

    return claimed.length > 0;
  }

  /**
   * Pushes the expiry out while the job is still running. Returns false when no row matches this
   * RUN any more.
   *
   * That is not the same as "the claim was lost", and a caller must not read it as one. There are
   * two ways to match nothing: the claim lapsed and another process took it over, or this run's own
   * `release` already deleted the row while this statement was still in flight — which is a run that
   * COMPLETED. `keepAlive` tells them apart before reporting anything; see the check there.
   */
  async renew(job: string, owner: string): Promise<boolean> {
    const [, affected] = await this.dataSource.query(
      `UPDATE "cron_lease"
       SET "expires" = now() + ($3 || ' seconds')::interval
       WHERE "name" = $1 AND "owner" = $2`,
      [job, owner, `${LEASE_TTL_SECONDS}`],
    );

    this.recordSuccess();

    return affected > 0;
  }

  /**
   * Releases the lease. Scoped to the owner that took it, so a run which already lost the lease
   * cannot delete the row another run is now holding — in another process or in this one.
   *
   * Returns whether a row actually went. That is the fact `keepAlive` needs to tell its own release
   * apart from a takeover: a DELETE that removed a row proves the row was still THIS run's at that
   * moment, so any later renewal that matches nothing is matching nothing because of this. A DELETE
   * that removed none proves the opposite just as firmly — the row had already been taken or was
   * gone — and the loss is real.
   */
  async release(job: string, owner: string): Promise<boolean> {
    const [, affected] = await this.dataSource.query(`DELETE FROM "cron_lease" WHERE "name" = $1 AND "owner" = $2`, [
      job,
      owner,
    ]);

    this.recordSuccess();

    return affected > 0;
  }

  /**
   * Runs `task` only if this process can claim the lease, and keeps the claim alive meanwhile.
   *
   * Failing to reach the database means NOT running — under `api` or `worker`. There the lease is
   * the only thing keeping the job to one process, and a job that moves money must not proceed on
   * the assumption that it is probably alone. The caller sees the same outcome as a job whose
   * lease is held elsewhere: it does not run this cycle and tries again on the next.
   *
   * Under `all` it means running anyway. That role IS one process, the shape this deployment had
   * before any lease existed, so stopping there would make an unreachable table strictly worse
   * than its own absence — see the branch in the catch below.
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

    const owner = this.newOwner();

    // Read BEFORE the claim is issued, not after it answers. The database stamps `expires` from
    // its own clock when it executes the statement, which is after this line and before the answer
    // gets back here; taking the later of the two would credit the claim with a round trip it never
    // had. Only used to describe how old a claim is in the loss line, but the direction of that
    // error is the one that would understate it.
    const claimedAt = Date.now();

    let acquired: boolean;
    try {
      acquired = await this.acquire(job, owner);
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

      // Through `track` rather than as a bare `task()`. The two things the healthy path does
      // between here and the call are not about the lease at all, and skipping them would make
      // this run less safe than every other: it would be invisible to `shutdown` — no grace, and
      // absent from the "still running" warning — and it would start even if shutdown had begun
      // during the failed claim, which is a longer window than the healthy one because the
      // attempt runs to the database timeout.
      return this.track(job, owner, task);
    }

    if (!acquired) {
      if (reportContention)
        this.logger.error(
          `Skipped ${job}: another process holds the lease. This job only has an effect in the ` +
            `process that runs it, so that effect did not happen here`,
        );

      return;
    }

    // Claiming the lease is a round trip, and shutdown can begin during it. `track` below checks
    // for that as its first act and hands the claim straight back rather than starting under it,
    // so the successor does not sit out the expiry for a job that never ran.
    //
    // This is best effort, not a guarantee: a job still inside its claim is not in `inFlight`
    // yet, so `shutdown` does not wait for it, and the process can exit before the release runs.
    // What then remains is a claim nobody holds — it lapses within the TTL like any other, which
    // is the bound that always applies. The release only ever shortens that wait.
    const renewal = this.keepAlive(job, owner, claimedAt);

    return this.track(job, owner, task, () => {
      renewal.stop();

      return this.release(job, owner)
        .then((removed) => renewal.released(removed))
        .catch((e) => {
          // Nothing is reported to `renewal` here on purpose: a release that did not answer leaves
          // it unknown whether the row went, and the honest default is the one that still reports a
          // loss rather than the one that hides it.
          this.recordFailure(e);
          this.logger.error(`Could not release the lease for ${job}`, e);
        });
    });
  }

  /**
   * Runs a task as one this process is known to be running.
   *
   * Everything a run needs regardless of whether it holds a claim: the shutdown check that must
   * happen as late as possible, and the `inFlight` entry that makes the run visible to
   * `shutdown`. Both were once written out only on the path that holds a lease, which left the
   * lease-less path — the one taken when the table cannot be reached under `all` — without either.
   *
   * `after` is what the claim-holding path adds: stop renewing, hand the claim back. The
   * lease-less path has nothing to hand back.
   */
  private async track(
    job: string,
    owner: string,
    task: () => Promise<void>,
    after?: () => Promise<void>,
  ): Promise<void> {
    // As late as possible, because the step before it is a round trip: shutdown can begin while a
    // claim is being taken, or while a failing attempt runs to its timeout. A run started after
    // that point is not in the set `shutdown` waits on and would be cut off part-way through.
    if (this.shuttingDown) {
      await after?.();
      return;
    }

    const run = (async () => {
      try {
        await task();
      } finally {
        await after?.();
        this.inFlight.delete(owner);
      }
    })();

    this.inFlight.set(owner, { job, run: run.catch(() => undefined) });

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

    const running = [...this.inFlight.values()].map((entry) => entry.run);
    if (!running.length) return;

    this.logger.info(`Shutting down: waiting up to ${SHUTDOWN_GRACE_MS / 1000}s for ${running.length} running job(s)`);

    await Promise.race([Promise.all(running), this.shutdownGrace()]);

    const stranded = [...this.inFlight.values()].map((entry) => entry.job);
    if (stranded.length)
      this.logger.warn(
        `Shutting down with ${stranded.length} job(s) still running (${stranded.join(', ')}); ` +
          `their leases stay held and lapse within ${LEASE_TTL_SECONDS}s`,
      );
  }

  /**
   * The state of the lease layer, for the role heartbeat to report.
   *
   * Read rather than pushed, and it has to be read under BOTH roles because it means different
   * things: under `api` or `worker` a lease that cannot reach its table stops every worker- and
   * api-scoped job, and no other line says so; under `all` it stops nothing, but the jobs then run
   * without a claim, which is the state to fix before the roles are split. `healthy` stays false
   * until an operation succeeds, so neither case falls quiet after the first window. The counter
   * is per window; the last message is not, so an unhealthy report always names something.
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
   * once the previous attempt has settled bounds that to a single outstanding statement.
   *
   * The wait that follows is measured from when the attempt STARTED, so a slow answer no longer
   * pushes the next attempt out behind it — it comes due sooner, or at once if the interval has
   * already passed. Re-arming from the ANSWER instead added the database's latency to a wait that
   * was already sized to include it, which is how an answer arriving at 45 s used to put the next
   * attempt five seconds past the expiry. See RENEWAL_INTERVAL_MS.
   *
   * Losing the claim does not stop the run. There is nothing here that could stop it, and the
   * timer deliberately keeps going: this process holds the claim for as long as it can renew it.
   *
   * Because it keeps going, the loss is reported as a TRANSITION rather than on every attempt. The
   * run carries on to its own end — up to two hours for the longest timeouts — and an unlatched
   * line would repeat every 20 s for all of it, turning one event into some 360 lines. Counting
   * lines would then measure how LONG the affected runs were, not how OFTEN the claim was lost,
   * which is the number the TTL has to be dimensioned on.
   *
   * The latch is one-way on purpose, though not because a lapsed claim is always taken over —
   * `renew` carries no expiry predicate, so a claim nobody else has claimed yet is silently revived
   * by a late renewal and answers true. What cannot be undone is a FALSE: it means zero rows matched
   * `name + owner`, so the row is either gone or already re-owned, and the owner is unique per run.
   * Neither is reversible for this run, so clearing the latch would describe an unreachable state.
   */
  private keepAlive(
    job: string,
    owner: string,
    claimedAt: number,
  ): { stop: () => void; released: (removed: boolean) => void } {
    let stopped = false;
    let timer: NodeJS.Timeout;
    let reportedLoss = false;
    let worstReportedMs = 0;

    /**
     * Whether this run's own `release` is known to have removed the row.
     *
     * This is the whole of the false-loss problem, and the row answers it exactly. `stop` cannot
     * cancel an attempt that has already fired, so a finishing run races its own release: the
     * DELETE lands first, the outstanding UPDATE then matches nothing, and a run that COMPLETED
     * reads as one that lost its claim. Those false lines arrive in same-second cohorts whenever a
     * stall releases queued statements together — the burst that made this line unusable.
     *
     * A DELETE that removed a row proves the row was still THIS run's when it ran, so nothing had
     * taken it and any later unmatched renewal is unmatched because of that DELETE. A DELETE that
     * removed nothing proves the row had already gone or been re-owned, and the loss is real and
     * still reported. A release that threw leaves this false, which reports — the direction that
     * errs towards a line too many rather than a double run kept quiet.
     *
     * Two weaker tests were tried first and both were wrong. `stopped` says only that the run
     * ended, never why the renewal matched nothing: a claim taken over at 60 s on a run that ends
     * at 70 s answers false at 75 s with `stopped` set, dropping a real double run — and the window
     * is widest exactly when a slow database makes losses likely. Comparing the claim's age against
     * the TTL fixed that direction but not this one: "the claim COULD have lapsed" is equally true
     * of a clean release that raced a stalled renewal, so the false lines came back for any stall
     * past the remaining margin. It also rested on the app's clock agreeing with the database's,
     * and on an expiry predicate that `acquire` applies only when the row still exists.
     */
    let releasedOwnRow = false;

    /**
     * When the claim was last confirmed to name this run — the claim itself to begin with, then the
     * START of each renewal the row accepted.
     *
     * The start and not the answer, for the same reason the schedule uses the start: the database
     * stamped `expires` when it executed the statement, which is before the answer arrived here, so
     * anchoring on the answer would report a claim as younger than it is. Informational only — it
     * is the age printed in the loss line, not a term in any decision.
     */
    let acceptedAt = claimedAt;

    const schedule = (delay: number): void => {
      // Unref'd: a pending timer must never hold the process open on shutdown.
      timer = setTimeout(async () => {
        const startedAt = Date.now();

        try {
          const stillOurs = await this.renew(job, owner);

          if (stillOurs) {
            acceptedAt = startedAt;
          } else if (!reportedLoss && !releasedOwnRow) {
            reportedLoss = true;
            this.logger.error(
              `Lost the lease for ${job} (owner ${owner}, ` +
                `${Util.secondsDiff(new Date(acceptedAt)).toFixed(1)} s since the claim was last confirmed)`,
            );
          }
        } catch (e) {
          // Deliberately not latched, unlike the two lines above. Each failure is a distinct event
          // with its own cause attached, and it also feeds `takeFailures` for the heartbeat, which
          // counts per window and would under-report a persistent outage if this returned early.
          this.recordFailure(e);
          this.logger.error(`Could not extend the lease for ${job}`, e);
        }

        // One sample, read once, used for both the threshold and the number that gets printed —
        // and outside the try, because a renewal that is slow and then REJECTS is exactly what the
        // statement timeout this threshold is named after would produce. Measuring inside the arm
        // that answered would report nothing at all for precisely that case.
        const elapsed = Date.now() - startedAt;

        // Reported only when it is the worst this run has seen. Slowness persists, so a line per
        // attempt would emit some 360 of them for a two-hour run and count run length rather than
        // runs affected; latching the FIRST one instead would hold the number at 6 s for a run
        // whose renewals then went to 300 s, and 300 s is what a timeout would have to be sized
        // against. A monotonic high-water mark is a handful of lines and keeps the largest.
        if (elapsed >= SLOW_RENEWAL_MS && elapsed > worstReportedMs) {
          worstReportedMs = elapsed;
          this.logger.warn(`Renewing the lease for ${job} took ${(elapsed / 1000).toFixed(1)} s (owner ${owner})`);
        }

        // Whatever this attempt already spent comes off the next wait, so a slow answer does not
        // push the next attempt out behind it. Clamped at BOTH ends: `Date.now()` is a wall clock,
        // and a backward step — NTP correction, resume from suspend — would otherwise make the
        // elapsed term negative and the wait longer than an interval, on the one timer that must
        // not miss a deadline. Zero is the other end: an attempt that outran the interval is
        // already overdue and re-arms at once.
        if (!stopped) schedule(Math.min(RENEWAL_INTERVAL_MS, Math.max(0, RENEWAL_INTERVAL_MS - elapsed)));
      }, delay);
      timer.unref();
    };

    schedule(RENEWAL_INTERVAL_MS);

    return {
      stop: () => {
        stopped = true;
        clearTimeout(timer);
      },
      // Told to the renewal only after the DELETE has answered, which is the only moment its result
      // is known. An attempt that answers before this point cannot be the release race — the row was
      // still there to match — so nothing is missed by the flag arriving late.
      released: (removed: boolean) => {
        releasedOwnRow = removed;
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
