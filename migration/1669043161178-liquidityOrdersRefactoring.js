const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class liquidityOrdersRefactoring1669043161178 {
  name = 'liquidityOrdersRefactoring1669043161178';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_71e5779fa056105fa716299d2f1"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.purchaseStrategy", "strategy"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.purchaseTxId", "txId"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.purchaseFeeAmount", "feeAmount"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.purchaseFeeAssetId", "feeAssetId"`);
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_8c116f65742249f450313610c2b" FOREIGN KEY ("feeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_8c116f65742249f450313610c2b"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.feeAssetId", "purchaseFeeAssetId"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.feeAmount", "purchaseFeeAmount"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.txId", "purchaseTxId"`);
    await queryRunner.query(`EXEC sp_rename "liquidity_order.strategy", "purchaseStrategy"`);
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_71e5779fa056105fa716299d2f1" FOREIGN KEY ("purchaseFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
};
