/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataPhoneCallExternalAccount1774526765422 {
    name = 'AddUserDataPhoneCallExternalAccount1774526765422'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallExternalAccountCheckDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallExternalAccountCheckValues" nvarchar(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallExternalAccountCheckValues"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallExternalAccountCheckDate"`);
    }
}
