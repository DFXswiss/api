/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataVerificationCallTime1770470071165 {
    name = 'AddUserDataVerificationCallTime1770470071165'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallTimes" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallStatus" nvarchar(256)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallStatus"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallTimes"`);
    }
}
