/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BankTxCodes1765493597313 {
    name = 'BankTxCodes1765493597313'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "domainCode" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "familyCode" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx" ADD "subFamilyCode" nvarchar(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "subFamilyCode"`);
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "familyCode"`);
        await queryRunner.query(`ALTER TABLE "bank_tx" DROP COLUMN "domainCode"`);
    }
}
