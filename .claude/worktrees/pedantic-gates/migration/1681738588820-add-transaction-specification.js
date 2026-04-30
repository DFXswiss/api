const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionSpecification1681738588820 {
    name = 'addTransactionSpecification1681738588820'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "transaction_specification" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_be0907dbdfc4e31be21e1a03362" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b18f84bb2cda2aa39cc9602eae5" DEFAULT getdate(), "system" nvarchar(256) NOT NULL, "asset" nvarchar(256), "direction" nvarchar(256), "minVolume" float NOT NULL, "minFee" float NOT NULL, CONSTRAINT "PK_d70959b6561ccf42cc03daaf705" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d5c03a4d9cec4553143c5ceeb5" ON "transaction_specification" ("system", "asset", "direction") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_d5c03a4d9cec4553143c5ceeb5" ON "transaction_specification"`);
        await queryRunner.query(`DROP TABLE "transaction_specification"`);
    }
}
