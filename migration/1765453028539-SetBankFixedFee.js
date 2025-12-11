/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SetBankFixedFee1765453028539 {
    name = 'SetBankFixedFee1765453028539'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`UPDATE "fee" SET "fixed" = 1 WHERE "type" = 'Bank'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`UPDATE "fee" SET "fixed" = 0 WHERE "type" = 'Bank'`);
    }
}
