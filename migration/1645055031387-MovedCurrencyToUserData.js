const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class MovedCurrencyToUserData1645055031387 {
    name = 'MovedCurrencyToUserData1645055031387'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "currencyId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD CONSTRAINT "FK_03359a6602ce5796029a29f119c" FOREIGN KEY ("currencyId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "FK_03359a6602ce5796029a29f119c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "currencyId"`);
    }
}
