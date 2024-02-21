const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class WalletFees1692364580860 {
  name = 'WalletFees1692364580860';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "buyFee" float`);
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "sellFee" float`);
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "cryptoFee" float`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "cryptoFee"`);
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "sellFee"`);
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "buyFee"`);
  }
};
