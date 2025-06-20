/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LiquidityLimit1750404224308 {
    name = 'LiquidityLimit1750404224308'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" ADD "limit" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_rule" DROP COLUMN "limit"`);
    }
}
