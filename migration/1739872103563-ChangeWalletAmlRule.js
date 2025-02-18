const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangeWalletAmlRule1739872103563 {
    name = 'ChangeWalletAmlRule1739872103563'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "wallet.amlRule", "amlRules"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_acb672652f95b21fb90e025dce0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "DF_19a183bac114682a3a8920e7961" DEFAULT 0 FOR "amlRules"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_19a183bac114682a3a8920e7961"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "amlRules"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "amlRules" nvarchar(255) NOT NULL CONSTRAINT "DF_19a183bac114682a3a8920e7961" DEFAULT '0'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_19a183bac114682a3a8920e7961"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "amlRules"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "amlRules" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "DF_19a183bac114682a3a8920e7961" DEFAULT 0 FOR "amlRules"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_19a183bac114682a3a8920e7961"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "DF_acb672652f95b21fb90e025dce0" DEFAULT 0 FOR "amlRules"`);
        await queryRunner.query(`EXEC sp_rename "wallet.amlRules", "amlRule"`);
    }
}
