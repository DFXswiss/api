/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFiatOutputYapealMsgId1765370944186 {
    name = 'AddFiatOutputYapealMsgId1765370944186'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" ADD "yapealMsgId" nvarchar(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "yapealMsgId"`);
    }
}
