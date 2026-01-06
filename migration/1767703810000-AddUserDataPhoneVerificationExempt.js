const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserDataPhoneVerificationExempt1767703810000 {
    name = 'AddUserDataPhoneVerificationExempt1767703810000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "phoneVerificationExempt" bit NOT NULL CONSTRAINT "DF_user_data_phoneVerificationExempt" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_user_data_phoneVerificationExempt"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "phoneVerificationExempt"`);
    }
}
