/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Explicit Buy PaymentInfo Frick personal-IBAN selector support:
 * - nullable scalar bankId / virtualIbanId on transaction_request (no FKs)
 * - virtual_iban_issuance_intent for cross-instance, crash-recoverable Frick vIBAN issuance
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
    await queryRunner.query(`CREATE INDEX "IDX_transaction_request_bankId" ON "transaction_request" ("bankId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transaction_request_virtualIbanId" ON "transaction_request" ("virtualIbanId") `,
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
        CONSTRAINT "UQ_virtual_iban_issuance_intent_requestReference" UNIQUE ("requestReference"),
        CONSTRAINT "UQ_virtual_iban_issuance_intent_user_currency_bank" UNIQUE ("userDataId", "currencyId", "bankId"),
        CONSTRAINT "PK_virtual_iban_issuance_intent" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_virtual_iban_issuance_intent_userDataId" ON "virtual_iban_issuance_intent" ("userDataId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_virtual_iban_issuance_intent_currencyId" ON "virtual_iban_issuance_intent" ("currencyId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_virtual_iban_issuance_intent_bankId" ON "virtual_iban_issuance_intent" ("bankId") `,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`DROP INDEX "public"."IDX_virtual_iban_issuance_intent_bankId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_virtual_iban_issuance_intent_currencyId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_virtual_iban_issuance_intent_userDataId"`);
    await queryRunner.query(`DROP TABLE "virtual_iban_issuance_intent"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_transaction_request_virtualIbanId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_transaction_request_bankId"`);
    await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "virtualIbanId"`);
    await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "bankId"`);
  }
};
