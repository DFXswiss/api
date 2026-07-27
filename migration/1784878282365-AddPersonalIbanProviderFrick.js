/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Explicit Buy PaymentInfo Frick personal-IBAN selector support:
 * - nullable scalar bankId / virtualIbanId on transaction_request (no FKs)
 * - virtual_iban_issuance_intent for cross-instance, crash-recoverable Frick vIBAN issuance
 * - append-only virtual_iban_issuance_event rows for every intent snapshot transition
 *
 * Intentionally does NOT add any unique constraint on virtual_iban (prod has active Yapeal
 * duplicates that would break such a migration) and does not clean existing vIBAN rows.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPersonalIbanProviderFrick1784878282365 {
  name = 'AddPersonalIbanProviderFrick1784878282365';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`ALTER TABLE "transaction_request" ADD "bankId" integer`);
    await queryRunner.query(`ALTER TABLE "transaction_request" ADD "virtualIbanId" integer`);
    await queryRunner.query(`CREATE INDEX "IDX_b90d35b3e375065328eed4b7f0" ON "transaction_request" ("bankId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_322f94a4ebb62e67ec880f7b98" ON "transaction_request" ("virtualIbanId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "virtual_iban_issuance_intent" (
        "id" SERIAL NOT NULL,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "requestReference" character varying(64) NOT NULL,
        "userDataId" integer NOT NULL,
        "currencyId" integer NOT NULL,
        "bankId" integer NOT NULL,
        "status" character varying(32) NOT NULL,
        "externalIban" character varying(34),
        "error" text,
        CONSTRAINT "UQ_f397220bbb6e7e8b3d24d694605" UNIQUE ("requestReference"),
        CONSTRAINT "PK_6770d752dc7fe3523add80065a1" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_b2192a6137c2bf4227da3fad6f" ON "virtual_iban_issuance_intent" ("userDataId", "currencyId", "bankId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_da5b830c24dbb7b9eb62c44408" ON "virtual_iban_issuance_intent" ("userDataId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_54fcaf3b2e029ba042672d82c8" ON "virtual_iban_issuance_intent" ("currencyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_659351abecd8dfb6f4c5a78c7b" ON "virtual_iban_issuance_intent" ("bankId") `,
    );

    await queryRunner.query(
      `CREATE TABLE "virtual_iban_issuance_event" (
        "id" SERIAL NOT NULL,
        "updated" TIMESTAMP NOT NULL DEFAULT now(),
        "created" TIMESTAMP NOT NULL DEFAULT now(),
        "intentId" integer NOT NULL,
        "userDataId" integer NOT NULL,
        "currencyId" integer NOT NULL,
        "bankId" integer NOT NULL,
        "previousStatus" character varying(32) NOT NULL,
        "nextStatus" character varying(32) NOT NULL,
        "previousExternalIban" character varying(34),
        "nextExternalIban" character varying(34),
        "previousError" text,
        "nextError" text,
        CONSTRAINT "PK_988a55d9c5d428fcfd475f78294" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_580678e6381e31186dc016daa8" ON "virtual_iban_issuance_event" ("intentId") `,
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
        (SELECT count(*) FROM "virtual_iban_issuance_intent") +
        (SELECT count(*) FROM "transaction_request" WHERE "virtualIbanId" IS NOT NULL) +
        (SELECT count(*) FROM "transaction_request" WHERE "bankId" IS NOT NULL)
      )::int AS "cnt"
    `);
    const { cnt } = rows.at(0);
    const persistedValueCount = Number(cnt);
    if (persistedValueCount > 0) {
      throw new Error(
        `AddPersonalIbanProviderFrick down(): refusing to destroy ${persistedValueCount} persisted ` +
          `issuance/history/routing value(s). Reconcile and archive them before rollback.`,
      );
    }

    await queryRunner.query(`DROP INDEX "public"."IDX_580678e6381e31186dc016daa8"`);
    await queryRunner.query(`DROP TABLE "virtual_iban_issuance_event"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_659351abecd8dfb6f4c5a78c7b"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_54fcaf3b2e029ba042672d82c8"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_da5b830c24dbb7b9eb62c44408"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b2192a6137c2bf4227da3fad6f"`);
    await queryRunner.query(`DROP TABLE "virtual_iban_issuance_intent"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_322f94a4ebb62e67ec880f7b98"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b90d35b3e375065328eed4b7f0"`);
    await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "virtualIbanId"`);
    await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "bankId"`);
  }
};
