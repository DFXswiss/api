const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addSpecialExternalIbanTable1709650387730 {
    name = 'addSpecialExternalIbanTable1709650387730'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "special_external_iban" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_9d258301f90b1b7bd448bb5f74e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_20a40225b846905221bf2e09d3f" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "name" nvarchar(256), "iban" nvarchar(256), "bic" nvarchar(256), "comment" nvarchar(256), CONSTRAINT "PK_ab1f28b1018f86336f70c041ec4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`DROP TABLE "multi_account_iban"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE TABLE "multi_account_iban" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_d43a740331db8ccf7e16e1c4465" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_415a3cf87adb222b0ea1c92971a" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "iban" nvarchar(256) NOT NULL, "comment" nvarchar(256), CONSTRAINT "PK_67b4a5ccc3295e5dce80159732a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`DROP TABLE "special_external_iban"`);
    }
}
