const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class indexNameChange1656519269231 {
    name = 'indexNameChange1656519269231'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanLabel" ON "dbo"."bank_account"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "branchCode"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "branchCode" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "sctInstReadinessDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "sctInstReadinessDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "userId" int NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanUser" ON "dbo"."bank_account" ("iban", "userId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d"`);
        await queryRunner.query(`DROP INDEX "ibanUser" ON "dbo"."bank_account"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "userId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "sctInstReadinessDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "sctInstReadinessDate" datetime`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "branchCode"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "branchCode" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_c2ba1381682b0291238cbc7a65d" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanLabel" ON "dbo"."bank_account" ("iban", "userId") `);
    }
}
