/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddWalletType1760436276323 {
    name = 'AddWalletType1760436276323'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user" ADD "walletType" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "ip_log" ADD "walletType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ip_log" DROP COLUMN "walletType"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "walletType"`);
    }
}
