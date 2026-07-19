/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (phase 1, issue #4280). Store the native quantity ALSO as EXACT integer base units
 * (amount × 10^asset.decimals, e.g. satoshi/wei) in a `numeric` column — the exact-integer model the CHF side already
 * uses (amountChfCents/bigint). Purely additive + nullable: the float `amount` and the enforced CHF close are untouched
 * (no CHK/behaviour change). The booking service now writes amountBaseUnits for every new leg on an asset-backed
 * account; this backfills the existing legs to the SAME value it would write, deriving base units from the stored
 * (≤8-dp §2.3) float amount rounded to 8 dp FIRST — matching prepareLeg — so the numeric round after scaling recovers
 * the intended integer and the float's binary error never leaks into the base-unit integer. Only legs on a ledger_account
 * with an assetId whose asset has a known decimals are backfilled; fiat / TRANSIT / EQUITY / EXPENSE legs stay null
 * (CHF-denominated, already exact via amountChfCents; native-crypto TRANSIT legs are a later phase).
 *
 * Verified on: dev/prod pending merge. Runs at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLedgerLegAmountBaseUnits1784600000000 {
    name = 'AddLedgerLegAmountBaseUnits1784600000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ledger_leg" ADD "amountBaseUnits" numeric`);
        await queryRunner.query(`
            UPDATE "ledger_leg" l
            SET "amountBaseUnits" = round(round((l."amount")::numeric, 8) * power(10::numeric, a."decimals"))
            FROM "ledger_account" acc
            JOIN "asset" a ON a."id" = acc."assetId"
            WHERE l."accountId" = acc."id" AND acc."assetId" IS NOT NULL AND a."decimals" IS NOT NULL
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ledger_leg" DROP COLUMN "amountBaseUnits"`);
    }
}
