/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Create the append-only `job_attempt` table: one immutable row per claim of a job, recording who took the
 * attempt, when, and how it ended (including the full error). The `job` snapshot row alone cannot carry that
 * history — every retry would overwrite `claimedAt`, `claimedBy`, `startedAt` and `error` and destroy the
 * prior attempt's proof. This table is the durable event log those overwrites would otherwise erase.
 *
 * The unique index on `("jobId", "attempt")` ensures the same attempt of the same job can never be recorded
 * twice, no matter how often claimNext, finish, abort or recoverStale run against it. `jobId` is NOT NULL
 * because an attempt always belongs to exactly one job.
 *
 * @param {QueryRunner} queryRunner
 */
module.exports = class AddJobAttemptTable1785930100000 {
  name = 'AddJobAttemptTable1785930100000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "job_attempt" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "jobId" integer NOT NULL, "attempt" integer NOT NULL, "claimedBy" character varying(256) NOT NULL, "claimedAt" TIMESTAMP NOT NULL, "finishedAt" TIMESTAMP, "outcome" character varying(256), "error" text, CONSTRAINT "PK_cae15a4b6ee8638059fb15054e2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b501e31b3f9bd927efe01b7a96" ON "job_attempt" ("jobId", "attempt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_attempt" ADD CONSTRAINT "FK_cbf1dd429e2b8c2afe2d71a6d8e" FOREIGN KEY ("jobId") REFERENCES "job"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "job_attempt" DROP CONSTRAINT "FK_cbf1dd429e2b8c2afe2d71a6d8e"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b501e31b3f9bd927efe01b7a96"`);
    await queryRunner.query(`DROP TABLE "job_attempt"`);
  }
};
