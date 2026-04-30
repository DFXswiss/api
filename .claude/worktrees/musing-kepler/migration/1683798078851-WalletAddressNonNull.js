const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class WalletAddressNonNull1683798078851 {
  name = 'WalletAddressNonNull1683798078851';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a2a383c25694d1306ef993f846" ON "dbo"."wallet" ("address") WHERE address IS NOT NULL`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "IDX_a2a383c25694d1306ef993f846" ON "dbo"."wallet"`);
    await queryRunner.query(
      `ALTER TABLE "dbo"."wallet" ADD CONSTRAINT "UQ_1dcc9f5fd49e3dc52c6d2393c53" UNIQUE ("address")`,
    );
  }
};
