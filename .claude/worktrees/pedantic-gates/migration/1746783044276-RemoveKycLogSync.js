const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveKycLogSync1746783044276 {
    name = 'RemoveKycLogSync1746783044276'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP COLUMN "synced"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD "synced" bit`);
    }
}
