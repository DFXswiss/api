const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeBankAccountUserCols1733922716978 {
    name = 'removeBankAccountUserCols1733922716978'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_14e0fdcf6c86d9a5296cc5cd9c7"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_166fa63a5cb0089c3268454f577"`);
        await queryRunner.query(`DROP INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "label"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "preferredCurrencyId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "userDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "DF_ec679d1e8bd77302b9bfe2d29c5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "active"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "synced"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "UQ_1deee23ad14488afdae0bc92baa" UNIQUE ("iban")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "UQ_1deee23ad14488afdae0bc92baa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "synced" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "active" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "DF_ec679d1e8bd77302b9bfe2d29c5" DEFAULT 1 FOR "active"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "userDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "preferredCurrencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "label" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7ac3599aae96c391aeb374088" ON "dbo"."bank_account" ("iban", "userDataId") `);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_166fa63a5cb0089c3268454f577" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_14e0fdcf6c86d9a5296cc5cd9c7" FOREIGN KEY ("preferredCurrencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
