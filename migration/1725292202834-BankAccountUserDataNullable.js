const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class BankAccountUserDataNullable1725292202834 {
    name = 'BankAccountUserDataNullable1725292202834'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_166fa63a5cb0089c3268454f577"`);
        await queryRunner.query(`DROP INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "userDataId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account" ("iban", "userDataId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_166fa63a5cb0089c3268454f577" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_166fa63a5cb0089c3268454f577"`);
        await queryRunner.query(`DROP INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "userDataId" int NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account" ("iban", "userDataId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_166fa63a5cb0089c3268454f577" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
