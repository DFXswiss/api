import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The cross-process claim on a scheduled job. One row per job name; see CronLeaseService, which is
 * the only thing that reads or writes it.
 *
 * It exists as an entity even though the service never goes through a repository. The claim is a
 * single `INSERT .. ON CONFLICT .. WHERE`, whose atomicity is the whole point and which the query
 * builder cannot express, so the statements stay hand-written. But a table that exists only as DDL
 * inside a migration is invisible to the entity model, and the next generated migration would read
 * that absence as an instruction: it would carry a `DROP TABLE "cron_lease"`, and the lock would be
 * gone without anyone deciding it should be.
 *
 * The timestamps are `timestamptz`. They are compared
 * against `now()` in raw SQL rather than mapped through a Date on the way in and out, and a
 * `timestamp` on one side of that comparison is resolved through whatever time zone the session
 * happens to carry — the same row then expires an hour late or an hour early across a daylight
 * saving change, and outright inconsistently between two sessions that disagree. An hour late
 * means the job runs nowhere; an hour early means two processes run it at once.
 *
 * Kept in step with migration/1785600000000-AddCronLease.js by
 * src/shared/models/cron-lease/__tests__/cron-lease.entity.spec.ts.
 */
@Entity()
export class CronLease {
  /** The job, as `<provider class>::<method>` — the name DfxCronService registers it under. */
  @PrimaryColumn({ length: 256 })
  name: string;

  /** The process holding it: its role and a per-process random part. */
  @Column({ length: 256 })
  owner: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  acquired: Date;

  @Column({ type: 'timestamptz' })
  expires: Date;
}
