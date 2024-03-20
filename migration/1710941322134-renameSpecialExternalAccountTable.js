const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class renameSpecialExternalAccountTable1710941322134 {
    name = 'renameSpecialExternalAccountTable1710941322134'

    async up(queryRunner) {
        await queryRunner.query(`DROP TABLE "special_external_bank_account"`);
        await queryRunner.query(`CREATE TABLE "special_external_account" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_fc2cde35137354ed1ac2e62eb85" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_1c1d3843f3255a2e588f8a6af96" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "name" nvarchar(256), "value" nvarchar(256), "comment" nvarchar(256), CONSTRAINT "PK_7828513bb883a1aeb7ebe81fc9b" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE TABLE "special_external_bank_account" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_9d258301f90b1b7bd448bb5f74e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_20a40225b846905221bf2e09d3f" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "name" nvarchar(256), "iban" nvarchar(256), "bic" nvarchar(256), "comment" nvarchar(256), CONSTRAINT "PK_ab1f28b1018f86336f70c041ec4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`DROP TABLE "special_external_account"`);
    }
}
