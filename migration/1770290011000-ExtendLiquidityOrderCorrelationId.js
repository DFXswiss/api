/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ExtendLiquidityOrderCorrelationId1770290011000 {
    name = 'ExtendLiquidityOrderCorrelationId1770290011000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ALTER COLUMN "correlationId" nvarchar(MAX)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ALTER COLUMN "correlationId" nvarchar(256)`);
    }
}
