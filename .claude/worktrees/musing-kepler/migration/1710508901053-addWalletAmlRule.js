const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addWalletAmlRule1710508901053 {
    name = 'addWalletAmlRule1710508901053'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "amlRule" int NOT NULL CONSTRAINT "DF_acb672652f95b21fb90e025dce0" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "DF_acb672652f95b21fb90e025dce0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "amlRule"`);
    }
}
