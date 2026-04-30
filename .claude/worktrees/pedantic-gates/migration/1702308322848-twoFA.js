const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class twoFA1702308322848 {
    name = 'twoFA1702308322848'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "totpSecret" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" ADD "ipAddress" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_log" DROP COLUMN "ipAddress"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "totpSecret"`);
    }
}
