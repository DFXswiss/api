/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddChargebackAsset1771337617394 {
    name = 'AddChargebackAsset1771337617394'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_return" ADD "chargebackAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "chargebackAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "chargebackAsset" nvarchar(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "chargebackAsset"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "chargebackAsset"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_return" DROP COLUMN "chargebackAsset"`);
    }
}
