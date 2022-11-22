const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankAccountPreferrredCurrency1660735191489 {
    name = 'bankAccountPreferrredCurrency1660735191489'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD "preferredCurrencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "FK_14e0fdcf6c86d9a5296cc5cd9c7" FOREIGN KEY ("preferredCurrencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "FK_14e0fdcf6c86d9a5296cc5cd9c7"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP COLUMN "preferredCurrencyId"`);
    }
}
