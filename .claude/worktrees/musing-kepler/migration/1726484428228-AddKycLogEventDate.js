const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddKycLogEventDate1726484428228 {
    name = 'AddKycLogEventDate1726484428228'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD "eventDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP COLUMN "eventDate"`);
    }
}
