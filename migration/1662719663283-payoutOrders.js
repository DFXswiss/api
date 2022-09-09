const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class payoutOrders1662719663283 {
  name = 'payoutOrders1662719663283';

  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "payout_order" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_c962900745f742c3bfb79eb3772" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_77e65c6e94f256d8d4a21592269" DEFAULT getdate(), "context" nvarchar(256) NOT NULL, "correlationId" nvarchar(256) NOT NULL, "chain" nvarchar(256) NOT NULL, "amount" float NOT NULL, "destinationAddress" nvarchar(256) NOT NULL, "status" nvarchar(256) NOT NULL, "transferTxId" nvarchar(256), "payoutTxId" nvarchar(256), "assetId" int, CONSTRAINT "PK_b8871a008d488ac0065baff70f8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "payout_order" ADD CONSTRAINT "FK_104e583561878b016c275c3c6b3" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" ADD "blockchain" nvarchar(256)`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP COLUMN "outTxId"`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" ADD "outTxId" nvarchar(256)`);
    await queryRunner.query(`ALTER TABLE "buy_crypto_batch" DROP COLUMN "blockchain"`);
    await queryRunner.query(`ALTER TABLE "payout_order" DROP CONSTRAINT "FK_104e583561878b016c275c3c6b3"`);
    await queryRunner.query(`DROP TABLE "payout_order"`);
  }
};
