/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBinancePayColumns1749183174663 {
    name = 'AddBinancePayColumns1749183174663'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "storeType" int`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "merchantMcc" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "goodsType" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "goodsCategory" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "goodsCategory"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "goodsType"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "merchantMcc"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "storeType"`);
    }
}
