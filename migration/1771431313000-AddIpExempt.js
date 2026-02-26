/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddIpExempt1771431313000 {
    name = 'AddIpExempt1771431313000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "ipExempt" bit NOT NULL CONSTRAINT "DF_UserData_ipExempt" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP CONSTRAINT "DF_UserData_ipExempt"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "ipExempt"`);
    }
}
