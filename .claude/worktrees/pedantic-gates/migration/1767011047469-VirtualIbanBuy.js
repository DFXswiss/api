/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class VirtualIbanBuy1767011047469 {
    name = 'VirtualIbanBuy1767011047469'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ADD "personalIbanEnabled" bit NOT NULL CONSTRAINT "DF_8d1cd7102585152c8ca84de1f6f" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD "buySpecificIbanEnabled" bit NOT NULL CONSTRAINT "DF_a5c1053a8460daee80fe637c421" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD "buyId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e60e925997c6033297d9ef4c71" ON "virtual_iban" ("currencyId", "buyId") WHERE buyId IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" ADD CONSTRAINT "FK_a706f77e40a7e9fb2f745d1fb73" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP CONSTRAINT "FK_a706f77e40a7e9fb2f745d1fb73"`);
        await queryRunner.query(`DROP INDEX "IDX_e60e925997c6033297d9ef4c71" ON "virtual_iban"`);
        await queryRunner.query(`ALTER TABLE "virtual_iban" DROP COLUMN "buyId"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "DF_a5c1053a8460daee80fe637c421"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "buySpecificIbanEnabled"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_8d1cd7102585152c8ca84de1f6f"`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "personalIbanEnabled"`);
    }
}
