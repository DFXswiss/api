const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addHigRiskAndAmlAccountType1699010411038 {
    name = 'addHigRiskAndAmlAccountType1699010411038'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "highRisk" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "highRisk" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "highRisk" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "amlAccountType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "amlAccountType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "highRisk"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "highRisk"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "highRisk"`);
    }
}
