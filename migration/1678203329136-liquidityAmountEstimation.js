const { MigrationInterface, QueryRunner } = require('typeorm');

module.exports = class liquidityAmountEstimation1678203329136 {
  name = 'liquidityAmountEstimation1678203329136';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "estimatedTargetAmount" float`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "estimatedTargetAmount"`);
  }
};
