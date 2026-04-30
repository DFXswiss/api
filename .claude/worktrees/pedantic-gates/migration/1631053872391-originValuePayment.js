const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class originValuePayment1631053872391 {
    name = 'originValuePayment1631053872391'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD "originFiatValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD "originFiatId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD CONSTRAINT "FK_218095796c52b7fb09a4c41986c" FOREIGN KEY ("originFiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP CONSTRAINT "FK_218095796c52b7fb09a4c41986c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP COLUMN "originFiatId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP COLUMN "originFiatValue"`);
    }
}
