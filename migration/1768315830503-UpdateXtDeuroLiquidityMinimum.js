/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class UpdateXtDeuroLiquidityMinimum1768315830503 {
    name = 'UpdateXtDeuroLiquidityMinimum1768315830503'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Update XT/DEURO liquidity rule minimum from 4300 to 10000
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 10000
            WHERE "id" = 295
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Revert XT/DEURO liquidity rule minimum back to 4300
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 4300
            WHERE "id" = 295
        `);
    }
}
