/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * One-off data repair for fiat_output 83398, see #4738. PRD-only (id is a production identity);
 * no-op elsewhere, same pattern as DeactivateTradingRules. Guarded to that single row via the
 * same candidate conditions FiatOutputJobService.notifyScryptDeposit uses, plus an audit row so
 * the prior NULL stays reconstructible after the update. Postcondition asserts the row actually
 * reached the notified state, so a guard mismatch can't record itself as executed while leaving
 * #4738's alert unresolved.
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
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`
      WITH "target" AS (
        SELECT "id", "scryptDepositNotifiedDate" AS "previousNotifiedDate"
        FROM "fiat_output"
        WHERE "id" = 83398
          AND "type" = 'LiqManagement'
          AND "isComplete" = true
          AND "name" LIKE '%Scrypt Digital Trading%'
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

    // .at(0) rather than array destructuring or a bracketed index access: migration-psql-check.spec.ts's
    // guard flags any square-bracket-quoted identifier as MSSQL syntax and cannot tell it apart from
    // ordinary JavaScript array indexing.
    const row = (
      await queryRunner.query(`SELECT "scryptDepositNotifiedDate" FROM "fiat_output" WHERE "id" = 83398`)
    ).at(0);

    if (!row?.scryptDepositNotifiedDate)
      throw new Error('ResolveStuckScryptDepositNotification: fiat_output 83398 did not reach a notified state');
  }

  async down() {
    // Deliberately no-op: a blind NULL-out isn't guarded or audited, and could destroy a
    // notified state set independently after up() ran. The prior NULL is preserved in up()'s
    // audit log line; re-arming the alert is an operational decision, not a mechanical inverse.
  }
};
