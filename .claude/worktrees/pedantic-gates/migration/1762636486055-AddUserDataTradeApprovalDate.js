/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataTradeApprovalDate1762636486055 {
    name = 'AddUserDataTradeApprovalDate1762636486055'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "tradeApprovalDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "tradeApprovalDate"`);
    }
}
