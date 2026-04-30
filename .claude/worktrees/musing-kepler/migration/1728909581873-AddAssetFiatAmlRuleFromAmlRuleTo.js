const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAssetFiatAmlRuleFromAmlRuleTo1728909581873 {
    name = 'AddAssetFiatAmlRuleFromAmlRuleTo1728909581873'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "asset.amlRule", "amlRuleFrom"`);
        await queryRunner.query(`EXEC sp_rename "fiat.amlRule", "amlRuleFrom"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "amlRuleTo" int NOT NULL CONSTRAINT "DF_417487aa3c4c4a14d1db0b45210" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "amlRuleTo" int NOT NULL CONSTRAINT "DF_1c1192f2ff5e789f3f60cb3032c" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_1c1192f2ff5e789f3f60cb3032c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "amlRuleTo"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_417487aa3c4c4a14d1db0b45210"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "amlRuleTo"`);
        await queryRunner.query(`EXEC sp_rename "fiat.amlRuleFrom", "amlRule"`);
        await queryRunner.query(`EXEC sp_rename "asset.amlRuleFrom", "amlRule"`);
    }
}
