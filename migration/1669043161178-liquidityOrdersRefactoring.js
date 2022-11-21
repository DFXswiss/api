const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class liquidityOrdersRefactoring1669043161178 {
    name = 'liquidityOrdersRefactoring1669043161178'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_71e5779fa056105fa716299d2f1"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "purchaseStrategy"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "purchaseTxId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "purchaseFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "purchaseFeeAssetId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "strategy" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "txId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "feeAmount" float`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "feeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_8c116f65742249f450313610c2b" FOREIGN KEY ("feeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_8c116f65742249f450313610c2b"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "feeAssetId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "feeAmount"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "txId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "strategy"`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "purchaseFeeAssetId" int`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "purchaseFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "purchaseTxId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "purchaseStrategy" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_71e5779fa056105fa716299d2f1" FOREIGN KEY ("purchaseFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
