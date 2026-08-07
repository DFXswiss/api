/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Create the `job` table backing the generic command-job model: an endpoint whose work no longer fits
 * inside a request persists a job, answers with its `uid` as a ticket, and a dispatcher executes it.
 *
 * Two indexes, both load-bearing rather than decorative:
 *
 * - `("status", "group", "id")` is the dispatcher's access path. Every claim attempt reads the oldest
 *   claimable rows of one group; without the index that is a sequential scan per sweep, once per group
 *   per minute.
 * - `("group", "idempotencyKey")` UNIQUE carries idempotency in the database rather than in code. Two
 *   concurrent enqueues of the same business key cannot both create a job — the loser gets a unique
 *   violation and loads the winner's row. This is what makes a retried confirmation link harmless.
 *
 * `attempt` defaults to 0 so existing-row concerns do not arise (the table starts empty), and
 * `maxAttempts` is written per job on purpose: a job carries the limit it was created under, so a
 * later configuration change cannot silently re-budget work that is already in flight.
 *
 * The `userDataId` foreign key is nullable because a job may be triggered by an unauthenticated flow
 * (the account-merge confirmation link is the first case). Where it is set, the status endpoint uses it
 * to refuse a job that belongs to another account.
 *
 * @param {QueryRunner} queryRunner
 */
module.exports = class AddJobTable1785930000000 {
  name = 'AddJobTable1785930000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "job" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "uid" character varying(256) NOT NULL, "group" character varying(256) NOT NULL, "status" character varying(256) NOT NULL, "idempotencyKey" character varying(256) NOT NULL, "input" text NOT NULL, "output" text, "attempt" integer NOT NULL DEFAULT '0', "maxAttempts" integer NOT NULL, "claimedAt" TIMESTAMP, "claimedBy" character varying(256), "startedAt" TIMESTAMP, "finishedAt" TIMESTAMP, "nextAttemptAt" TIMESTAMP, "error" text, "traceparent" character varying(256), "userDataId" integer, CONSTRAINT "UQ_84d390c08e353b6202e6495bada" UNIQUE ("uid"), CONSTRAINT "PK_98ab1c14ff8d1cf80d18703b92f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_e8aa536bda884c9f342b9783ca" ON "job" ("status", "group", "id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_595111195612c6fb0889278bce" ON "job" ("group", "idempotencyKey")`,
    );
    await queryRunner.query(
      `ALTER TABLE "job" ADD CONSTRAINT "FK_df137d89d7c792e8a5d7d97719c" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "job" DROP CONSTRAINT "FK_df137d89d7c792e8a5d7d97719c"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_595111195612c6fb0889278bce"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_e8aa536bda884c9f342b9783ca"`);
    await queryRunner.query(`DROP TABLE "job"`);
  }
};
