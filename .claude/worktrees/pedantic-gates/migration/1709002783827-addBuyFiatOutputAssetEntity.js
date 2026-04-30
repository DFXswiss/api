const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBuyFiatOutputAssetEntity1709002783827 {
    name = 'addBuyFiatOutputAssetEntity1709002783827'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputReferenceAssetEntityId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputAssetEntityId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_6a4e7ed37d66dc2c61850254133" FOREIGN KEY ("outputReferenceAssetEntityId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_63bb76ac49a36fef0c9f8503743" FOREIGN KEY ("outputAssetEntityId") REFERENCES "fiat"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_63bb76ac49a36fef0c9f8503743"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_6a4e7ed37d66dc2c61850254133"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputAssetEntityId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputReferenceAssetEntityId"`);
    }
}
