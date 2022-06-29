const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankAccount1656083888483 {
    name = 'addBankAccount1656083888483'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "bank_account" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_e448d9d770fa67d038635fe6b3f" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_851eb81c7038902e0a6fdd0179c" DEFAULT getdate(), "iban" nvarchar(256) NOT NULL, "label" nvarchar(256), "result" nvarchar(256), "returnCode" int, "checks" nvarchar(256), "bic" nvarchar(256), "allBicCandidates" nvarchar(256), "bankCode" nvarchar(256), "bankAndBranchCode" nvarchar(256), "bankName" nvarchar(256), "bankAddress" nvarchar(256), "bankUrl" nvarchar(256), "branch" nvarchar(256), "branchCode" nvarchar(255), "sct" bit, "sdd" bit, "b2b" bit, "scc" bit, "sctInst" bit, "sctInstReadinessDate" datetime, "acountNumber" nvarchar(256), "dataAge" nvarchar(256), "ibanListed" nvarchar(256), "ibanWwwOccurrences" int, "userId" int, CONSTRAINT "PK_f3246deb6b79123482c6adb9745" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanLabel" ON "bank_account" ("iban", "userId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "bankAccountId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "bankAccountId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "FK_14b7c5eab01c490849dba4c2917" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bank_account" ADD CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_account" DROP CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "FK_14b7c5eab01c490849dba4c2917"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "bankAccountId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "bankAccountId"`);
        await queryRunner.query(`DROP INDEX "ibanLabel" ON "bank_account"`);
        await queryRunner.query(`DROP TABLE "bank_account"`);
    }
}
