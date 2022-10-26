const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class feesAndAssetReferences1666774727290 {
  name = 'feesAndAssetReferences1666774727290';

  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "buy_crypto_fee" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_5d6821f63ac7fee2578852037fa" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_e7958cfa15682c6e1a9677ae2a9" DEFAULT getdate(), "estimatePurchaseFeeAmount" float NOT NULL, "estimatePurchaseFeePercent" float NOT NULL, "estimatePayoutFeeAmount" float NOT NULL, "estimatePayoutFeePercent" float NOT NULL, "actualPurchaseFeeAmount" float, "actualPurchaseFeePercent" float, "actualPayoutFeeAmount" float, "actualPayoutFeePercent" float, "buyCryptoId" int, "feeAssetId" int NOT NULL, CONSTRAINT "PK_5d15f373a8930e6732ef7e9e425" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "REL_eb25df1202d7a05df6146b4229" ON "buy_crypto_fee" ("buyCryptoId") WHERE "buyCryptoId" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" ADD "outputReferenceAssetId" int`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" ADD "outputAssetId" int`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "outputReferenceAssetId" int`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "outputAssetId" int`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "purchaseFeeAmount" float`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "referenceAssetId" int`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "swapAssetId" int`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "purchaseFeeAssetId" int`);
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "preparationFeeAmount" float`);
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "payoutFeeAmount" float`);
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "preparationFeeAssetId" int`);
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "payoutFeeAssetId" int`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_1e75a3f4817c922d85cf3e9be16"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ALTER COLUMN "targetAssetId" int`);
    await queryRunner.query(
      `ALTER TABLE "buy_crypto_fee" ADD CONSTRAINT "FK_eb25df1202d7a05df6146b4229d" FOREIGN KEY ("buyCryptoId") REFERENCES "buy_crypto"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "buy_crypto_fee" ADD CONSTRAINT "FK_88516904512221a608f408dadaf" FOREIGN KEY ("feeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "buy_crypto_batch" ADD CONSTRAINT "FK_37c45f78682091aa273e913c72c" FOREIGN KEY ("outputReferenceAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "buy_crypto_batch" ADD CONSTRAINT "FK_21f09aa92279d56f7dc8ffef07d" FOREIGN KEY ("outputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_60318af46443519f0e4f99194e0" FOREIGN KEY ("outputReferenceAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_7e9b3870afc645ce8a6a4e1fa91" FOREIGN KEY ("outputAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_5499b5d0a7e01d2433c6f6c97aa" FOREIGN KEY ("referenceAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_1e75a3f4817c922d85cf3e9be16" FOREIGN KEY ("targetAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_1a898d3850e8a95e1b7bede19c6" FOREIGN KEY ("swapAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_71e5779fa056105fa716299d2f1" FOREIGN KEY ("purchaseFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payout_order" ADD CONSTRAINT "FK_2b1d9ab3f1d324ba5e2cc42be4e" FOREIGN KEY ("preparationFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payout_order" ADD CONSTRAINT "FK_326829b48a410c35065d7f989a9" FOREIGN KEY ("payoutFeeAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "payout_order" DROP CONSTRAINT "FK_326829b48a410c35065d7f989a9"`);
    await queryRunner.query(`ALTER TABLE "payout_order" DROP CONSTRAINT "FK_2b1d9ab3f1d324ba5e2cc42be4e"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_71e5779fa056105fa716299d2f1"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_1a898d3850e8a95e1b7bede19c6"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_1e75a3f4817c922d85cf3e9be16"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_5499b5d0a7e01d2433c6f6c97aa"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_7e9b3870afc645ce8a6a4e1fa91"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_60318af46443519f0e4f99194e0"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP CONSTRAINT "FK_21f09aa92279d56f7dc8ffef07d"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP CONSTRAINT "FK_37c45f78682091aa273e913c72c"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_fee" DROP CONSTRAINT "FK_88516904512221a608f408dadaf"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_fee" DROP CONSTRAINT "FK_eb25df1202d7a05df6146b4229d"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ALTER COLUMN "targetAssetId" int NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_1e75a3f4817c922d85cf3e9be16" FOREIGN KEY ("targetAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "payoutFeeAssetId"`);
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "preparationFeeAssetId"`);
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "payoutFeeAmount"`);
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "preparationFeeAmount"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "purchaseFeeAssetId"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "swapAssetId"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "referenceAssetId"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "purchaseFeeAmount"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "outputAssetId"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "outputReferenceAssetId"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP COLUMN "outputAssetId"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP COLUMN "outputReferenceAssetId"`);
    await queryRunner.query(`DROP INDEX "REL_eb25df1202d7a05df6146b4229" ON "buy_crypto_fee"`);
    await queryRunner.query(`DROP TABLE "buy_crypto_fee"`);
  }
};
