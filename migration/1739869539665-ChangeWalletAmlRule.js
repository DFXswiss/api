const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangeWalletAmlRule1739869539665 {
    name = 'ChangeWalletAmlRule1739869539665'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "DF_acb672652f95b21fb90e025dce0"`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD CONSTRAINT "DF_acb672652f95b21fb90e025dce0" DEFAULT '0' FOR "amlRule"`);
        await queryRunner.query(`ALTER TABLE "wallet" ALTER COLUMN "amlRule" nvarchar(256)`);
        await queryRunner.query(`EXEC sp_rename "wallet.amlRule", "amlRules"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "wallet.amlRules", "amlRule"`);
        await queryRunner.query(`ALTER TABLE "asset" ALTER COLUMN "amlRule" int`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "DF_acb672652f95b21fb90e025dce0"`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD CONSTRAINT "DF_acb672652f95b21fb90e025dce0" DEFAULT 0 FOR "amlRule"`);
    }
}
