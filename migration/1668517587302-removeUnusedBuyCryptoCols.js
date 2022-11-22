const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeUnusedBuyCryptoCols1668517587302 {
    name = 'removeUnusedBuyCryptoCols1668517587302'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" DROP CONSTRAINT "FK_88516904512221a608f408dadaf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_batch" DROP COLUMN "outputReferenceAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_batch" DROP COLUMN "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "outputReferenceAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_order" DROP COLUMN "referenceAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_order" DROP COLUMN "swapAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" ADD CONSTRAINT "FK_5efe36a1cf182e40c0f2e34bb76" FOREIGN KEY ("feeReferenceAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" DROP CONSTRAINT "FK_5efe36a1cf182e40c0f2e34bb76"`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_order" ADD "swapAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_order" ADD "referenceAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "outputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "outputReferenceAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_batch" ADD "outputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_batch" ADD "outputReferenceAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" ADD CONSTRAINT "FK_88516904512221a608f408dadaf" FOREIGN KEY ("feeReferenceAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
