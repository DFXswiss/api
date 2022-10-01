const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankTable1664663025469 {
    name = 'addBankTable1664663025469'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "bank" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_5899d45992c402d145033b18a0e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_9a3bcb6f2b8d14dcea29aa4acf8" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "iban" nvarchar(256) NOT NULL, "bic" nvarchar(256) NOT NULL, "enable" bit NOT NULL CONSTRAINT "DF_cfec8f11d9833ae3c86ab5d8c3b" DEFAULT 1, CONSTRAINT "UQ_11f196da2e68cef1c7e84b4fe94" UNIQUE ("name"), CONSTRAINT "PK_7651eaf705126155142947926e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanBic" ON "bank" ("iban", "bic") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanBic" ON "bank"`);
        await queryRunner.query(`DROP TABLE "bank"`);
    }
}
