const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class linkAddress1660657475628 {
    name = 'linkAddress1660657475628'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "link_address" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_24fdafa57e7afce3283f4d9e3ea" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_ccec5278cd193c910b7754b22ea" DEFAULT getdate(), "existingAddress" nvarchar(256) NOT NULL, "newAddress" nvarchar(256) NOT NULL, "authentication" uniqueidentifier NOT NULL CONSTRAINT "DF_caebee0c1fa7bff3805c65fd011" DEFAULT NEWSEQUENTIALID(), "isCompleted" bit NOT NULL CONSTRAINT "DF_49a597cd8cd017f21400f8bca16" DEFAULT 0, "expiration" datetime2 NOT NULL, CONSTRAINT "PK_b3f43c5e9d87fe0428a6824a162" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_caebee0c1fa7bff3805c65fd01" ON "link_address" ("authentication") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_caebee0c1fa7bff3805c65fd01" ON "link_address"`);
        await queryRunner.query(`DROP TABLE "link_address"`);
    }
}
