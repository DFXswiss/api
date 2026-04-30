const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class Sanction1725004077486 {
    name = 'Sanction1725004077486'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "sanction" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_3e925b61f891a913fbab3035fb5" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_a2003f3dbe0654efc6b0137ac44" DEFAULT getdate(), "currency" nvarchar(255) NOT NULL, "address" nvarchar(255) NOT NULL, CONSTRAINT "PK_8e0d7d8cef573a237bb11a61c8a" PRIMARY KEY ("id"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "sanction"`);
    }
}
