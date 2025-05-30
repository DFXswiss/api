/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRegistrationNumberUserData1748442542239 {
    name = 'AddRegistrationNumberUserData1748442542239'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "registrationNumber" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "registrationNumber"`);
    }
}
