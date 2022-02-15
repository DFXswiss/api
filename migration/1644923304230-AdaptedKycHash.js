const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AdaptedKycHash1644923304230 {
    name = 'AdaptedKycHash1644923304230'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycHash" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycHash"`);
    }
}
