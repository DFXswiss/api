const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class AssetApproxPrice1684743418738 {
  name = 'AssetApproxPrice1684743418738';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "asset" ADD "approxPriceUsd" float`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "approxPriceUsd"`);
  }
};
