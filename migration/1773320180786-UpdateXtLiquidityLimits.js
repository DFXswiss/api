/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class UpdateXtLiquidityLimits1773320180786 {
    name = 'UpdateXtLiquidityLimits1773320180786'

    /**
     * Update XT liquidity management rules for DEPS(296), DEURO(295), and USDT(294).
     *
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 150000, "optimal" = 170000
            WHERE "id" = 296
        `);

        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "optimal" = 15000, "maximal" = 25000
            WHERE "id" = 295
        `);

        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 30000, "optimal" = 35000
            WHERE "id" = 294
        `);
    }

    /**
     * Revert to previous values.
     *
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 13300, "optimal" = 15000
            WHERE "id" = 296
        `);

        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "optimal" = 20000, "maximal" = NULL
            WHERE "id" = 295
        `);

        await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "minimal" = 26000, "optimal" = 30000
            WHERE "id" = 294
        `);
    }
}
