const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedMasternode1643764925428 {
    name = 'AddedMasternode1643764925428'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "masternode" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_0b459b3d55720a6f1cb75e9ad8c" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_0e8c92194bd6f9bbfd19a419d76" DEFAULT getdate(), "hash" nvarchar(256) NOT NULL, "owner" nvarchar(256) NOT NULL, "operator" nvarchar(256) NOT NULL, "server" nvarchar(256) NOT NULL, "timelock" int NOT NULL, "enabled" bit NOT NULL, CONSTRAINT "UQ_06b6f9276103df2261c06a8c3b2" UNIQUE ("hash"), CONSTRAINT "PK_80550f0c8b2ac59a059eb65a52a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "updated" datetime2 NOT NULL CONSTRAINT "DF_c37c653776a9da6d6d2d515bbc6" DEFAULT getdate()`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "created" datetime2 NOT NULL CONSTRAINT "DF_000e3eb5d3dad15c0d5cd46f13c" DEFAULT getdate()`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP CONSTRAINT "DF_000e3eb5d3dad15c0d5cd46f13c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "created"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP CONSTRAINT "DF_c37c653776a9da6d6d2d515bbc6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "updated"`);
        await queryRunner.query(`DROP TABLE "masternode"`);
    }
}
