/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPayoutOrderReleasedTxIds1784215858000 {
    name = 'AddPayoutOrderReleasedTxIds1784215858000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payout_order" ADD "releasedPayoutTxIds" character varying(2048)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "releasedPayoutTxIds"`);
    }
}
