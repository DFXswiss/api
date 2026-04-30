const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class newBuyProcess1656577848807 {
  name = 'newBuyProcess1656577848807';

  async up(queryRunner) {
    await queryRunner.query(
      `CREATE TABLE "buy_crypto_batch" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_0716f761deee2b8c326d4862aca" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_b0ce0ef52443c2e433bb3c88ba5" DEFAULT getdate(), "outputReferenceAsset" nvarchar(256), "outputReferenceAmount" float, "outputAsset" nvarchar(256), "outputAmount" float, "status" nvarchar(256), "outTxId" nvarchar(256), "purchaseTxId" nvarchar(256), CONSTRAINT "PK_3f76001fef895283ceef77d632e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "buy_crypto" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_8b300f904f1ebbf94512ae3f497" DEFAULT 0`,
    );
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "batchId" int`);
    await queryRunner.query(
      `ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_19bb6514f0c92a4088dcbf6617f" FOREIGN KEY ("batchId") REFERENCES "buy_crypto_batch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_19bb6514f0c92a4088dcbf6617f"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "batchId"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "DF_8b300f904f1ebbf94512ae3f497"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "isComplete"`);
    await queryRunner.query(`DROP TABLE "buy_crypto_batch"`);
  }
};
