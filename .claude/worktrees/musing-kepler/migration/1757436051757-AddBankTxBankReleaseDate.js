/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankTxBankReleaseDate1757436051757 {
    name = 'AddBankTxBankReleaseDate1757436051757'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "bankReleaseDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "bankReleaseDate"`);
    }
}
