/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ChangeNetworkTx1764000901998 {
    name = 'ChangeNetworkTx1764000901998'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.networkStartTx", "networkStartTxId"`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.networkStartTxId", "networkStartTx"`);
    }
}
