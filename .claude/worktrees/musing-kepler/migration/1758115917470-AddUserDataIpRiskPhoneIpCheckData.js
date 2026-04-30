/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataIpRiskPhoneIpCheckData1758115917470 {
    name = 'AddUserDataIpRiskPhoneIpCheckData1758115917470'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "phoneCallIpCheckDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "hasIpRisk" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "hasIpRisk"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "phoneCallIpCheckDate"`);
    }
}
