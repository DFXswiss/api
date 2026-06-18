/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAmlSource1781006197061 {
    name = 'AddAmlSource1781006197061'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "amlSource" character varying(256)`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "amlSource" character varying(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "amlSource"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "amlSource"`);
    }
}
