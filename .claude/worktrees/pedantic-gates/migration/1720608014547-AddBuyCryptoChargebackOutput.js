const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBuyCryptoChargebackOutput1720608014547 {
    name = 'AddBuyCryptoChargebackOutput1720608014547'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackOutputId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_6c92b74a836e3acbb564b8ad64" ON "dbo"."buy_crypto" ("chargebackOutputId") WHERE "chargebackOutputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_6c92b74a836e3acbb564b8ad642" FOREIGN KEY ("chargebackOutputId") REFERENCES "fiat_output"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_6c92b74a836e3acbb564b8ad642"`);
        await queryRunner.query(`DROP INDEX "REL_6c92b74a836e3acbb564b8ad64" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackOutputId"`);
    }
}
