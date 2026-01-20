/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RemoveBtcLiquidityLimit1768893600000 {
    name = 'RemoveBtcLiquidityLimit1768893600000'

    async up(queryRunner) {
        await queryRunner.query(`UPDATE "liquidity_management_rule" SET "limit" = NULL WHERE "id" = 79`);
    }

    async down(queryRunner) {
        await queryRunner.query(`UPDATE "liquidity_management_rule" SET "limit" = 0.8863205 WHERE "id" = 79`);
    }
}
