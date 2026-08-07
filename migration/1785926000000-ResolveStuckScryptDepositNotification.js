/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * One-off data repair for fiat_output 83398, see #4738. Idempotent and guarded to that single
 * row via the same candidate conditions FiatOutputJobService.notifyScryptDeposit uses, plus an
 * audit row so the prior NULL stays reconstructible after the update.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResolveStuckScryptDepositNotification1785926000000 {
  name = 'ResolveStuckScryptDepositNotification1785926000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      WITH "target" AS (
        SELECT "id", "scryptDepositNotifiedDate" AS "previousNotifiedDate"
        FROM "fiat_output"
        WHERE "id" = 83398
          AND "type" = 'LiqManagement'
          AND "isComplete" = true
          AND "scryptDepositNotifiedDate" IS NULL
        FOR UPDATE
      ),
      "audit" AS (
        INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
        SELECT now(), now(), 'Migration', 'ResolveStuckScryptDepositNotification1785926000000', 'Info',
          json_build_object(
            'fiatOutputId', "id",
            'previousNotifiedDate', "previousNotifiedDate",
            'nextNotifiedDate', now()
          )::text
        FROM "target"
        RETURNING 1
      )
      UPDATE "fiat_output" fo
      SET "scryptDepositNotifiedDate" = now(), "updated" = now()
      FROM "target" t
      WHERE fo."id" = t."id" AND EXISTS (SELECT 1 FROM "audit")
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE "fiat_output"
      SET "scryptDepositNotifiedDate" = NULL, "updated" = now()
      WHERE "id" = 83398
    `);
  }
};
