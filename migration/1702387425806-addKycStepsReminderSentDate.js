const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addKycStepsReminderSentDate1702387425806 {
    name = 'addKycStepsReminderSentDate1702387425806'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_step" ADD "reminderSentDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_step" DROP COLUMN "reminderSentDate"`);
    }
}
