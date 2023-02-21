const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addIpLogger1677015014694 {
    name = 'addIpLogger1677015014694'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "ip_log" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_27106482bf65a8f1504a34ad03f" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_acd9763921d8b674baaaa01ca41" DEFAULT getdate(), "address" nvarchar(256) NOT NULL, "ip" nvarchar(256) NOT NULL, "country" nvarchar(256), "url" nvarchar(256) NOT NULL, "result" bit NOT NULL, CONSTRAINT "PK_fa57c5c3d53da1f802990bac510" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "signature" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_8a21f1713dbe0211d8493128774" UNIQUE ("signature")`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "address" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ALTER COLUMN "address" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "mail"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_8a21f1713dbe0211d8493128774"`);
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "signature"`);
        await queryRunner.query(`DROP TABLE "ip_log"`);
    }
}
