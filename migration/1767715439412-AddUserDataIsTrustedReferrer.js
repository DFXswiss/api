/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataIsTrustedReferrer1767715439412 {
    name = 'AddUserDataIsTrustedReferrer1767715439412'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "isTrustedReferrer" bit NOT NULL CONSTRAINT "DF_37c1348125fec15f1c48f62d455" DEFAULT 0`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_37c1348125fec15f1c48f62d455"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "isTrustedReferrer"`);
    }
}
