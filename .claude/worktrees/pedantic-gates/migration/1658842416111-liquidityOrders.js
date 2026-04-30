const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class liquidityOrders1658842416111 {
  name = 'liquidityOrders1658842416111';

  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "liquidity_order" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_2d6c7dd38f16a6639f1cc1055b1" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_94004684697b3e7fa669db48d61" DEFAULT getdate(), "type" nvarchar(256) NOT NULL, "context" nvarchar(256) NOT NULL, "correlationId" nvarchar(256) NOT NULL, "chain" nvarchar(256) NOT NULL, "referenceAsset" nvarchar(256) NOT NULL, "referenceAmount" float NOT NULL, "targetAmount" float, "isReady" bit NOT NULL CONSTRAINT "DF_95177a5e9e0bbabd4fc518ae4aa" DEFAULT 0, "isComplete" bit NOT NULL CONSTRAINT "DF_86b8a58b1cf8411d757e33fb1bd" DEFAULT 0, "swapAsset" nvarchar(256), "swapAmount" float, "purchaseStrategy" nvarchar(256), "purchaseTxId" nvarchar(256), "purchasedAmount" float, "targetAssetId" int NOT NULL, CONSTRAINT "PK_ea07253c1548457d31400c38459" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP COLUMN "purchaseTxId"`);
    await queryRunner.query(
      `ALTER TABLE "liquidity_order" ADD CONSTRAINT "FK_1e75a3f4817c922d85cf3e9be16" FOREIGN KEY ("targetAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP CONSTRAINT "FK_1e75a3f4817c922d85cf3e9be16"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" ADD "purchaseTxId" nvarchar(256)`);
    await queryRunner.query(`DROP TABLE "liquidity_order"`);
  }
};
