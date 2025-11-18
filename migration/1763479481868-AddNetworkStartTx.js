/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddNetworkStartTx1763479481868 {
    name = 'AddNetworkStartTx1763479481868'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "networkStartAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "networkStartTx" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "networkStartAsset" nvarchar(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "networkStartAsset"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "networkStartTx"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "networkStartAmount"`);
    }
}
