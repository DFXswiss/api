const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class assetCategorization1658213098316 {
  name = 'assetCategorization1658213098316';

  async up(queryRunner) {
    await queryRunner.query(
      `ALTER TABLE "asset" ADD "category" nvarchar(256) NOT NULL CONSTRAINT "DF_834006608a30d1a762fa4618647" DEFAULT 'Stock'`,
    );
    await queryRunner.query(`UPDATE "asset" SET "category" = 'PoolPair' WHERE "isLP" = 1`);
    await queryRunner.query(
      `UPDATE "asset" SET "category" = 'Crypto' WHERE "dexName" IN ('DFI', 'BTC', 'ETH', 'USDT', 'USDC', 'LTC', 'BCH', 'DOGE')`,
    );
    await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_e424b7ab482d5938d5f85c2001c"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "isLP"`);
  }

  async down(queryRunner) {
    await queryRunner.query(
      `ALTER TABLE "asset" ADD "isLP" bit NOT NULL CONSTRAINT "DF_e424b7ab482d5938d5f85c2001c" DEFAULT 0`,
    );
    await queryRunner.query(`UPDATE "asset" SET "isLP" = 1 WHERE "category" = 'PoolPair'`);
    await queryRunner.query(`ALTER TABLE "asset" DROP CONSTRAINT "DF_834006608a30d1a762fa4618647"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "category"`);
  }
};
