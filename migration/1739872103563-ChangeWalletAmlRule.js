const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangeWalletAmlRule1739872103563 {
    name = 'ChangeWalletAmlRule1739872103563'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_acb672652f95b21fb90e025dce0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "amlRule"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "amlRules" nvarchar(255) NOT NULL CONSTRAINT "DF_19a183bac114682a3a8920e7961" DEFAULT '0'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_19a183bac114682a3a8920e7961"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "amlRules"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "amlRule" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "DF_acb672652f95b21fb90e025dce0" DEFAULT 0 FOR "amlRule"`);
    }
}
