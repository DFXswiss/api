/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Concrete Bank Frick IBANs and account roles are supplied out of band. This migration therefore
 * creates unmistakably synthetic, disabled placeholders in non-empty deployed registries. They
 * cannot receive or send until Operations replaces the IBANs and deliberately sets the role flags.
 * A fresh local registry stays empty here and is populated from migration/seed/bank.csv instead.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankFrickPayoutTracking1783944000000 {
  name = 'AddBankFrickPayoutTracking1783944000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickOrderId" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickTxId" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickOrderStatus" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickError" character varying(256)`);
    await queryRunner.query(`
      INSERT INTO "bank" ("updated", "created", "name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled")
      SELECT NOW(), NOW(), account."name", account."iban", account."bic", account."currency", FALSE, FALSE, FALSE, TRUE
      FROM (VALUES
        ('Bank Frick', 'LI4200000FRICKCHF0001', 'BFRILI22', 'CHF'),
        ('Bank Frick', 'LI5600000FRICKEUR0001', 'BFRILI22', 'EUR')
      ) AS account("name", "iban", "bic", "currency")
      WHERE EXISTS (SELECT 1 FROM "bank")
      ON CONFLICT ("iban", "bic") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "setting" ("key", "value", "updated", "created")
      VALUES (
        'disabledProcess',
        '["FiatOutputFrickTransmission","FiatOutputFrickStatusCheck"]',
        NOW(),
        NOW()
      )
      ON CONFLICT ("key") DO UPDATE SET "value" = (
        COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb
        || CASE
          WHEN COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb @> '["FiatOutputFrickTransmission"]'::jsonb
          THEN '[]'::jsonb ELSE '["FiatOutputFrickTransmission"]'::jsonb
        END
        || CASE
          WHEN COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb @> '["FiatOutputFrickStatusCheck"]'::jsonb
          THEN '[]'::jsonb ELSE '["FiatOutputFrickStatusCheck"]'::jsonb
        END
      )::text, "updated" = NOW()
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      UPDATE "setting"
      SET "value" = COALESCE((
        SELECT jsonb_agg(process)
        FROM jsonb_array_elements_text(COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb) AS processes(process)
        WHERE process NOT IN ('FiatOutputFrickTransmission', 'FiatOutputFrickStatusCheck')
      ), '[]'::jsonb)::text,
      "updated" = NOW()
      WHERE "key" = 'disabledProcess'
    `);
    await queryRunner.query(`
      DELETE FROM "bank"
      WHERE "name" = 'Bank Frick'
        AND "iban" IN ('LI4200000FRICKCHF0001', 'LI5600000FRICKEUR0001')
        AND "receive" = FALSE
        AND "send" = FALSE
    `);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickError"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickOrderStatus"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickTxId"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickOrderId"`);
  }
};
