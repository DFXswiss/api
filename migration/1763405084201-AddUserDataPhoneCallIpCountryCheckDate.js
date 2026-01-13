/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataPhoneCallIpCountryCheckDate1763405084201 {
    name = 'AddUserDataPhoneCallIpCountryCheckDate1763405084201'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallIpCountryCheckDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallIpCountryCheckDate"`);
    }
}
