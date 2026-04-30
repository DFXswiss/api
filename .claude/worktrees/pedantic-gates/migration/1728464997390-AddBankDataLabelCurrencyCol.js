const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBankDataLabelCurrencyCol1728464997390 {
    name = 'AddBankDataLabelCurrencyCol1728464997390'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "label" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "preferredCurrencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "synced" bit`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_254b6824b7059f39efb7631754" ON "dbo"."bank_data" ("iban", "userDataId") WHERE type = 'User'`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD CONSTRAINT "FK_15baf13321ac4e342a756fe015e" FOREIGN KEY ("preferredCurrencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP CONSTRAINT "FK_15baf13321ac4e342a756fe015e"`);
        await queryRunner.query(`DROP INDEX "IDX_254b6824b7059f39efb7631754" ON "dbo"."bank_data"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "synced"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "preferredCurrencyId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "label"`);
    }
}
