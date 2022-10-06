const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankTable1664663025469 {
    name = 'addBankTable1664663025469'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "bank" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_5899d45992c402d145033b18a0e" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_9a3bcb6f2b8d14dcea29aa4acf8" DEFAULT getdate(), "name" nvarchar(256) NOT NULL, "iban" nvarchar(256) NOT NULL, "bic" nvarchar(256) NOT NULL, "currency" nvarchar(256) NOT NULL, "receive" bit NOT NULL CONSTRAINT "DF_d2d28f0ad88353b74e41f8906da" DEFAULT 1, "send" bit NOT NULL CONSTRAINT "DF_9a989de49030a1379cb26e4a53f" DEFAULT 1, CONSTRAINT "PK_7651eaf705126155142947926e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanBic" ON "bank" ("iban", "bic") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanBic" ON "bank"`);
        await queryRunner.query(`DROP TABLE "bank"`);
    }
}
