import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Config } from 'src/config/config';
import { DataSource } from 'typeorm';
import { DfxLogger } from './dfx-logger';

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
 * ("until a human reads the alert") into a bounded one (the lease duration). A lost lease is
 * logged at error level, because it means the run that is still going has no claim to the job any
 * more.
 */
@Injectable()
export class CronLeaseService {
  private readonly logger = new DfxLogger(CronLeaseService);

  private ownerId?: string;

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
   * Claims the lease for `job`, or reports that someone else holds it.
   *
   * A single statement decides it: the insert either creates the row or takes it over from an
   * expired owner. Two processes racing here are serialised by the primary key, so exactly one of
   * them sees a returned row. Read the `WHERE` as "only if nobody is currently holding it" — an
   * unexpired row belonging to another process leaves the update out and returns nothing.
   */
  async acquire(job: string, ttlSeconds: number): Promise<boolean> {
    const claimed = await this.dataSource.query(
      `INSERT INTO "cron_lease" ("name", "owner", "acquired", "expires")
       VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval)
       ON CONFLICT ("name") DO UPDATE
         SET "owner" = EXCLUDED."owner", "acquired" = EXCLUDED."acquired", "expires" = EXCLUDED."expires"
         WHERE "cron_lease"."expires" <= now()
       RETURNING "owner"`,
      [job, this.owner, `${ttlSeconds}`],
    );

    return claimed.length > 0;
  }

  /**
   * Pushes the expiry out while the job is still running. Returns false when this process is no
   * longer the owner — which means another process has taken the job over and this run should be
   * treated as having lost its claim.
   */
  async renew(job: string, ttlSeconds: number): Promise<boolean> {
    const [, affected] = await this.dataSource.query(
      `UPDATE "cron_lease"
       SET "expires" = now() + ($3 || ' seconds')::interval
       WHERE "name" = $1 AND "owner" = $2`,
      [job, this.owner, `${ttlSeconds}`],
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
   */
  async run(job: string, ttlSeconds: number, task: () => Promise<void>): Promise<void> {
    let acquired: boolean;
    try {
      acquired = await this.acquire(job, ttlSeconds);
    } catch (e) {
      this.logger.error(`Skipping ${job}: could not reach the lease table`, e);
      return;
    }

    if (!acquired) return;

    // Renew at a third of the lease so two consecutive failures still leave a full attempt before
    // the lease lapses. Unref'd: a pending timer must never hold the process open on shutdown.
    const renewal = setInterval(
      () => {
        void this.renew(job, ttlSeconds)
          .then((stillOurs) => {
            if (!stillOurs) this.logger.error(`Lost the lease for ${job} while it was still running`);
          })
          .catch((e) => this.logger.error(`Could not extend the lease for ${job}`, e));
      },
      (ttlSeconds / 3) * 1000,
    );
    renewal.unref();

    try {
      await task();
    } finally {
      clearInterval(renewal);
      await this.release(job).catch((e) => this.logger.error(`Could not release the lease for ${job}`, e));
    }
  }
}
