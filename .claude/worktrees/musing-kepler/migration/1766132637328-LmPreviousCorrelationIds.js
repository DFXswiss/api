/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LmPreviousCorrelationIds1766132637328 {
    name = 'LmPreviousCorrelationIds1766132637328'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "previousCorrelationIds" nvarchar(MAX)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "previousCorrelationIds"`);
    }
}
