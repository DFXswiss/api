const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CascadeDeleteStepLogs1702638521946 {
    name = 'CascadeDeleteStepLogs1702638521946'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP CONSTRAINT "FK_0b0568192de90bc31d61a3cf364"`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD CONSTRAINT "FK_0b0568192de90bc31d61a3cf364" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP CONSTRAINT "FK_0b0568192de90bc31d61a3cf364"`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD CONSTRAINT "FK_0b0568192de90bc31d61a3cf364" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
