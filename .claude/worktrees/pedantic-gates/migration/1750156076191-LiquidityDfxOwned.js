/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LiquidityDfxOwned1750156076191 {
    name = 'LiquidityDfxOwned1750156076191'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_balance" DROP CONSTRAINT "FK_b46544dea6db1e9e9dd04b8da9d"`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" DROP COLUMN "fiatId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" ADD "isDfxOwned" bit NOT NULL CONSTRAINT "DF_42bc6388b83228c59b1c4747eb5" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_balance" DROP CONSTRAINT "DF_42bc6388b83228c59b1c4747eb5"`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" DROP COLUMN "isDfxOwned"`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" ADD "fiatId" int`);
        await queryRunner.query(`ALTER TABLE "liquidity_balance" ADD CONSTRAINT "FK_b46544dea6db1e9e9dd04b8da9d" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
