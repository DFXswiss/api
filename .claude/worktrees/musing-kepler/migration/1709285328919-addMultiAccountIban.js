const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addMultiAccountIban1709285328919 {
    name = 'addMultiAccountIban1709285328919'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "multi_account_iban" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_d43a740331db8ccf7e16e1c4465" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_415a3cf87adb222b0ea1c92971a" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "iban" nvarchar(256) NOT NULL, "comment" nvarchar(256), CONSTRAINT "PK_67b4a5ccc3295e5dce80159732a" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "multi_account_iban"`);
    }
}
