/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataPhoneCallAccepted1773675740273 {
    name = 'AddUserDataPhoneCallAccepted1773675740273'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallAccepted" bit`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallAccepted"`);
    }
}
