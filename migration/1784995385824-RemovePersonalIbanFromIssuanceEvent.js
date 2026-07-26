/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Replace cleartext personal-IBAN columns on the append-only issuance-event log with
 * by-reference VirtualIban.id scalars (no FK). Raw external IBAN stays only on
 * virtual_iban.iban and virtual_iban_issuance_intent.externalIban.
 *
 * Backfill uses UPDATE … FROM without aliasing the target table (fully-qualified
 * outer references only). That is valid Postgres and is the form pg-mem's parser
 * can execute; aliased-target UPDATE … FROM and correlated SET-subqueries both
 * fail under pg-mem's outer-column resolution.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RemovePersonalIbanFromIssuanceEvent1784995385824 {
  name = 'RemovePersonalIbanFromIssuanceEvent1784995385824';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "previousVirtualIbanId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "nextVirtualIbanId" integer`,
    );

    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "previousVirtualIbanId" = vi."id"
      FROM "virtual_iban" vi
      WHERE vi."iban" = "virtual_iban_issuance_event"."previousExternalIban"
        AND "virtual_iban_issuance_event"."previousExternalIban" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "nextVirtualIbanId" = vi."id"
      FROM "virtual_iban" vi
      WHERE vi."iban" = "virtual_iban_issuance_event"."nextExternalIban"
        AND "virtual_iban_issuance_event"."nextExternalIban" IS NOT NULL
    `);

    // Fail closed before dropping cleartext columns: unresolved rows would permanently lose
    // audit information. Check runs after backfill and before DROP so a throw rolls back cleanly.
    const orphanRows = await queryRunner.query(`
      SELECT count(*)::int AS "cnt"
      FROM "virtual_iban_issuance_event"
      WHERE ("previousExternalIban" IS NOT NULL AND "previousVirtualIbanId" IS NULL)
         OR ("nextExternalIban" IS NOT NULL AND "nextVirtualIbanId" IS NULL)
    `);
    const orphanCount = Number(orphanRows[0].cnt);
    if (orphanCount > 0) {
      throw new Error(
        `RemovePersonalIbanFromIssuanceEvent: ${orphanCount} issuance-event row(s) still have ` +
          `unresolved external IBAN references after backfill (previousExternalIban/nextExternalIban ` +
          `set but no matching virtual_iban row). Do not deploy until these orphans are resolved. ` +
          `Identify them with:\n` +
          `SELECT * FROM "virtual_iban_issuance_event" e WHERE ` +
          `(e."previousExternalIban" IS NOT NULL AND NOT EXISTS (` +
          `SELECT 1 FROM "virtual_iban" vi WHERE vi."iban" = e."previousExternalIban"` +
          `)) OR (e."nextExternalIban" IS NOT NULL AND NOT EXISTS (` +
          `SELECT 1 FROM "virtual_iban" vi WHERE vi."iban" = e."nextExternalIban"` +
          `));`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "previousExternalIban"`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "nextExternalIban"`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "previousExternalIban" character varying(34)`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "nextExternalIban" character varying(34)`,
    );

    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "previousExternalIban" = vi."iban"
      FROM "virtual_iban" vi
      WHERE vi."id" = "virtual_iban_issuance_event"."previousVirtualIbanId"
        AND "virtual_iban_issuance_event"."previousVirtualIbanId" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "nextExternalIban" = vi."iban"
      FROM "virtual_iban" vi
      WHERE vi."id" = "virtual_iban_issuance_event"."nextVirtualIbanId"
        AND "virtual_iban_issuance_event"."nextVirtualIbanId" IS NOT NULL
    `);

    // Fail closed before dropping id columns: unresolved rows would permanently lose the
    // VirtualIban.id → IBAN join target. Symmetric to up()'s orphan check after reverse backfill.
    const orphanRows = await queryRunner.query(`
      SELECT count(*)::int AS "cnt"
      FROM "virtual_iban_issuance_event"
      WHERE ("previousVirtualIbanId" IS NOT NULL AND "previousExternalIban" IS NULL)
         OR ("nextVirtualIbanId" IS NOT NULL AND "nextExternalIban" IS NULL)
    `);
    const orphanCount = Number(orphanRows[0].cnt);
    if (orphanCount > 0) {
      throw new Error(
        `RemovePersonalIbanFromIssuanceEvent down(): ${orphanCount} issuance-event row(s) still have ` +
          `unresolved VirtualIban id references after reverse backfill (previousVirtualIbanId/nextVirtualIbanId ` +
          `set but no matching virtual_iban row). Do not roll back until these orphans are resolved. ` +
          `Identify them with:\n` +
          `SELECT * FROM "virtual_iban_issuance_event" e WHERE ` +
          `(e."previousVirtualIbanId" IS NOT NULL AND NOT EXISTS (` +
          `SELECT 1 FROM "virtual_iban" vi WHERE vi."id" = e."previousVirtualIbanId"` +
          `)) OR (e."nextVirtualIbanId" IS NOT NULL AND NOT EXISTS (` +
          `SELECT 1 FROM "virtual_iban" vi WHERE vi."id" = e."nextVirtualIbanId"` +
          `));`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "previousVirtualIbanId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "nextVirtualIbanId"`,
    );
  }
};
