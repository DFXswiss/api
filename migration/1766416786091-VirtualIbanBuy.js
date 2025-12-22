/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class VirtualIbanBuy1766416786091 {
    name = 'VirtualIbanBuy1766416786091'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD "buyId" int`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_virtual_iban_buy" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "asset" ADD "personalIbanEnabled" bit NOT NULL CONSTRAINT "DF_asset_personalIbanEnabled" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "buySpecificIbanEnabled" bit NOT NULL CONSTRAINT "DF_wallet_buySpecificIbanEnabled" DEFAULT 0`);
        // Unique index to prevent duplicate vIBANs for same buy+currency (filtered index for non-null buyId only)
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_virtual_iban_buy_currency" ON "virtual_iban" ("buyId", "currencyId") WHERE "buyId" IS NOT NULL`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "UQ_virtual_iban_buy_currency" ON "virtual_iban"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "DF_wallet_buySpecificIbanEnabled"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "buySpecificIbanEnabled"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_asset_personalIbanEnabled"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "personalIbanEnabled"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_virtual_iban_buy"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP COLUMN "buyId"`);
    }
}
