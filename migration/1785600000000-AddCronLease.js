/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Cross-process lease for scheduled jobs.
 *
 * Until now the only thing stopping a job from running twice was `LockClass`, and its state is a
 * field in process memory — it cannot see a second process. That was acceptable while the API ran
 * as a single process. With the HTTP process and the worker split apart, "exactly one process runs
 * this job" became an assumption held up by configuration, a runbook sentence and an alert that
 * *reports* a double run about fifteen minutes after it starts. For a path that moves money,
 * detection is the second-best answer.
 *
 * This table bounds it: a job scoped to exactly one process must hold a row here for the duration
 * of its run, and the row is claimable by one process at a time until it expires. The expiry is
 * what makes this a bound rather than an exclusion — if the holder can no longer renew, a second
 * process can claim the row while the first is still working. See CronLeaseService, "What it does
 * not do".
 *
 * No foreign keys, deliberately: the table is infrastructure, not domain data, and a key into a
 * domain table would tie a coordination row to a schema it has no business depending on.
 * `name` is the primary key, so the claim is a single atomic upsert with no index to keep in sync.
 *
 * The primary key carries the name TypeORM derives for it, per the rule in CONTRIBUTING.md: `PK_`
 * plus the first 27 characters of sha1('cron_lease_name'). A hand-picked name would not be
 * recognised as its own by a schema comparison, which would offer to drop and recreate it.
 *
 * Both timestamps carry their time zone. They are compared against `now()` inside the claim and
 * renewal statements, and a value without a zone on one side of that comparison is resolved
 * through whatever time zone the session carries — which makes the same row expire an hour late
 * or an hour early across a daylight saving change, and inconsistently between two sessions that
 * disagree. An hour late is a job that runs nowhere, an hour early is two processes running it at
 * once.
 *
 * The shape of the table is mirrored by src/shared/models/cron-lease/cron-lease.entity.ts, without
 * which a generated migration would read the table as one to drop.
 *
 * @class @implements {MigrationInterface}
 */
module.exports = class AddCronLease1785600000000 {
  name = 'AddCronLease1785600000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "cron_lease" ("name" character varying(256) NOT NULL, "owner" character varying(256) NOT NULL, "acquired" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_a12c181c2b26f33be13d55a15af" PRIMARY KEY ("name"))`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP TABLE "cron_lease"`);
  }
};
