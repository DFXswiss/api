/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BankAddressMax1768216892259 {
    name = 'BankAddressMax1768216892259'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_account" ALTER COLUMN "bankAddress" nvarchar(MAX)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_account" ALTER COLUMN "bankAddress" nvarchar(256)`);
    }
}
