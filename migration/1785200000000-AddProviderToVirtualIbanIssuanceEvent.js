/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Snapshot the provider onto every append-only issuance event so Frick reconciliation can filter
 * histories without following mutable bank metadata or assuming every intent belongs to Frick.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddProviderToVirtualIbanIssuanceEvent1785200000000 {
  name = 'AddProviderToVirtualIbanIssuanceEvent1785200000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ADD "provider" character varying(256)`,
    );
    await queryRunner.query(`
      UPDATE "virtual_iban_issuance_event"
      SET "provider" = intent."provider"
      FROM "virtual_iban_issuance_intent" intent
      WHERE intent."id" = "virtual_iban_issuance_event"."intentId"
    `);

    const rows = await queryRunner.query(`
      SELECT count(*)::int AS "cnt"
      FROM "virtual_iban_issuance_event"
      WHERE "provider" IS NULL
    `);
    const { cnt } = rows.at(0);
    const unresolvedCount = Number(cnt);
    if (unresolvedCount > 0) {
      throw new Error(
        `AddProviderToVirtualIbanIssuanceEvent: ${unresolvedCount} event row(s) have no matching ` +
          `issuance intent provider. Restore the missing intent history before deploying.`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "virtual_iban_issuance_event" ALTER COLUMN "provider" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_081d5079f7e4a75fffa9e4493a" ON "virtual_iban_issuance_event" ("provider") `,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_081d5079f7e4a75fffa9e4493a"`);
    await queryRunner.query(`ALTER TABLE "virtual_iban_issuance_event" DROP COLUMN "provider"`);
  }
};
