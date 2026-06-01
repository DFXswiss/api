/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPayoutOrderRetryTracking1780071506610 {
    name = 'AddPayoutOrderRetryTracking1780071506610'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payout_order" ADD "retryCount" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "payout_order" ADD "lastError" character varying(2048)`);
        await queryRunner.query(`ALTER TABLE "payout_order" ADD "lastAttemptDate" TIMESTAMP`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "lastAttemptDate"`);
        await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "lastError"`);
        await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "retryCount"`);
    }
}
