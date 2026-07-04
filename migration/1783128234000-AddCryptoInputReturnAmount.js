/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCryptoInputReturnAmount1783128234000 {
    name = 'AddCryptoInputReturnAmount1783128234000'

    /**
     * Adds the real net amount actually sent back on a crypto return (input-asset units).
     * Nullable: existing rows and forwards cannot populate it, and reporting falls back to
     * chargebackAmount when it is null - this is intended, not a runtime fallback.
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "returnAmount" float`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "returnAmount"`);
    }
}
