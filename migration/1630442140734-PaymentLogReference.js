const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentLogReference1630442140734 {
    name = 'PaymentLogReference1630442140734'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment" ADD "btcValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" ADD "btcValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD "paymentId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" ADD "btcValue" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" ADD CONSTRAINT "FK_4711d35565c15dd3dd860b27b2b" FOREIGN KEY ("paymentId") REFERENCES "sqldb-dfx-api-dev".."payment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP CONSTRAINT "FK_4711d35565c15dd3dd860b27b2b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_payment" DROP COLUMN "btcValue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."log" DROP COLUMN "paymentId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."sell_payment" DROP COLUMN "btcValue"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment" DROP COLUMN "btcValue"`);
    }
}
