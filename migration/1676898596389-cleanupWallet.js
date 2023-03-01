const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class cleanupWallet1676898596389 {
    name = 'cleanupWallet1676898596389'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_8a21f1713dbe0211d8493128774"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "signature"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "mail"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "address" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "signature" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_8a21f1713dbe0211d8493128774" UNIQUE ("signature")`);
    }
}
