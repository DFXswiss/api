/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddTotalCustodyBalanceChfAuditPeriod1770287692177 {
    name = 'AddTotalCustodyBalanceChfAuditPeriod1770287692177'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "totalCustodyBalanceChfAuditPeriod" float`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "totalCustodyBalanceChfAuditPeriod"`);
    }
}
