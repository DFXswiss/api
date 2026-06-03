/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAccountMergeProcessingStartedAt1780349782017 {
    name = 'AddAccountMergeProcessingStartedAt1780349782017'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "account_merge" ADD "processingStartedAt" TIMESTAMP`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "account_merge" DROP COLUMN "processingStartedAt"`);
    }
}
