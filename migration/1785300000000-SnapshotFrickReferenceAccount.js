/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Persist the reference-account IBAN and receive-enabled state used to create every issuance
 * intent, and copy that immutable snapshot onto every append-only issuance event.
 *
 * Existing rows are backfilled from their bank once during deployment. The migration refuses to
 * continue if any bank cannot be resolved, rather than inventing a fallback snapshot.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SnapshotFrickReferenceAccount1785300000000 {
  name = 'SnapshotFrickReferenceAccount1785300000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_intent" ADD "referenceAccountIban" character varying(34)`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_intent" ADD "referenceAccountReceive" boolean`,
    );
    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_intent"
      SET "referenceAccountIban" = bank."iban",
          "referenceAccountReceive" = bank."receive"
      FROM "bank" bank
      WHERE bank."id" = "virtual_iban_issuance_intent"."bankId"
    `);

    const unresolvedIntents = await queryRunner.query(`
      SELECT count(*)::int AS "cnt"
      FROM "virtual_iban_issuance_intent"
      WHERE "referenceAccountIban" IS NULL
         OR "referenceAccountReceive" IS NULL
    `);
    const { cnt: unresolvedIntentRows } = unresolvedIntents.at(0);
    const unresolvedIntentCount = Number(unresolvedIntentRows);
    if (unresolvedIntentCount > 0) {
      throw new Error(
        `SnapshotFrickReferenceAccount: ${unresolvedIntentCount} intent row(s) have no resolvable ` +
          `Bank Frick reference-account snapshot. Repair the bank mapping before deploying.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_intent" ALTER COLUMN "referenceAccountIban" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_intent" ALTER COLUMN "referenceAccountReceive" SET NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "referenceAccountIban" character varying(34)`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "referenceAccountReceive" boolean`,
    );
    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "referenceAccountIban" = intent."referenceAccountIban",
          "referenceAccountReceive" = intent."referenceAccountReceive"
      FROM "virtual_iban_issuance_intent" intent
      WHERE intent."id" = "virtual_iban_issuance_event"."intentId"
    `);

    const unresolvedEvents = await queryRunner.query(`
      SELECT count(*)::int AS "cnt"
      FROM "virtual_iban_issuance_event"
      WHERE "referenceAccountIban" IS NULL
         OR "referenceAccountReceive" IS NULL
    `);
    const { cnt: unresolvedEventRows } = unresolvedEvents.at(0);
    const unresolvedEventCount = Number(unresolvedEventRows);
    if (unresolvedEventCount > 0) {
      throw new Error(
        `SnapshotFrickReferenceAccount: ${unresolvedEventCount} event row(s) have no matching ` +
          `intent reference-account snapshot. Restore the missing intent history before deploying.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ALTER COLUMN "referenceAccountIban" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ALTER COLUMN "referenceAccountReceive" SET NOT NULL`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    const rows = await queryRunner.query(`
      SELECT (
        (SELECT count(*) FROM "virtual_iban_issuance_event") +
        (SELECT count(*) FROM "virtual_iban_issuance_intent")
      )::int AS "cnt"
    `);
    const { cnt } = rows.at(0);
    const persistedSnapshotCount = Number(cnt);
    if (persistedSnapshotCount > 0) {
      throw new Error(
        `SnapshotFrickReferenceAccount down(): refusing to destroy ${persistedSnapshotCount} ` +
          `reference-account snapshot(s). Reconcile and archive them before rollback.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "referenceAccountReceive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "referenceAccountIban"`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_intent" DROP COLUMN "referenceAccountReceive"`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_intent" DROP COLUMN "referenceAccountIban"`,
    );
  }
};
