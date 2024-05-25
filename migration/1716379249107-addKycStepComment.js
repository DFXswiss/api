const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addKycStepComment1716379249107 {
    name = 'addKycStepComment1716379249107'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_step" ADD "comment" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_step" DROP COLUMN "comment"`);
    }
}
