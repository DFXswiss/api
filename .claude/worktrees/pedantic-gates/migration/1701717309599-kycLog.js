const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class kycLog1701717309599 {
    name = 'kycLog1701717309599'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD "status" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD "kycStepId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD CONSTRAINT "FK_0b0568192de90bc31d61a3cf364" FOREIGN KEY ("kycStepId") REFERENCES "kyc_step"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP CONSTRAINT "FK_0b0568192de90bc31d61a3cf364"`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP COLUMN "kycStepId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP COLUMN "status"`);
    }
}
