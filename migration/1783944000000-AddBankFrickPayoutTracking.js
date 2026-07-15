/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Schema-only migration: `fiat_output` payout-tracking columns, the `bank.sendPriority` sender
 * tie-breaker column (backfilled to a neutral default on every existing row), and the default-off
 * process switches. It deliberately never inserts, updates or deletes `bank` rows - the only prior
 * migration that ever did that (`1768943778000-AddYapealEurManualBank.js`) was reverted because the
 * row was already inserted manually (`f897b98a2`). The two new Bank Frick account rows, and any
 * cleanup of the legacy Bank Frick rows, are manual production steps documented in
 * `docs/bank-frick-operations.md` §3, exactly like the existing Yapeal EUR account. A fresh local
 * registry is populated from migration/seed/bank.csv instead.
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
    // Bank Frick's orderId is a plain integer (max 16 digits); varchar(64) is deliberately generous
    // rather than the unrelated 256-character width used for the other string-identifier columns below.
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickOrderId" character varying(64)`);
    // Stores DFX's own generated customId (e.g. "DFX-FO-42"), not a Bank Frick transaction id - named
    // accordingly rather than "frickTxId".
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickCustomId" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickOrderStatus" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickError" character varying(256)`);
    // Holds exactly the reference string sent to Bank Frick (customId-prefixed, bank-bound) so
    // reconciliation can match on it without ever overwriting the customer-facing remittanceInfo.
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickReference" character varying(256)`);
    // Sender priority is a deliberate, operator-controlled tie-breaker: lower value tried first. Every
    // pre-existing bank row is backfilled to the neutral default (1000) so this column changes nothing
    // about today's routing. The new Frick rows are seeded worse than that default (2000) so simply
    // flipping Frick's `send` flag on cannot silently steal traffic from a working incumbent (Olkypay,
    // Yapeal) — Ops must deliberately lower Frick's priority below the incumbent's to cut over.
    await queryRunner.query(`ALTER TABLE "bank" ADD "sendPriority" integer NOT NULL DEFAULT 1000`);
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
    await queryRunner.query(`ALTER TABLE "bank" DROP COLUMN "sendPriority"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickReference"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickError"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickOrderStatus"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickCustomId"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickOrderId"`);
  }
};
