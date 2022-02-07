const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedKycStatusChangeDate1643904788026 {
    name = 'AddedKycStatusChangeDate1643904788026'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycStatusChangeDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycStatusChangeDate"`);
    }
}
