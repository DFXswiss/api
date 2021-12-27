const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoBuysFix1640624148186 {
    name = 'CryptoBuysFix1640624148186'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "currency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "fiatId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD CONSTRAINT "FK_15fed97f119b13cebfc1a4e154c" FOREIGN KEY ("fiatId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP CONSTRAINT "FK_15fed97f119b13cebfc1a4e154c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "fiatId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "currency" nvarchar(256)`);
    }
}
