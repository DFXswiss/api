module.exports = class AddAvailableAmountToLiquidityBalance1774000000000 {
  name = 'AddAvailableAmountToLiquidityBalance1774000000000';

  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."liquidity_balance" ADD "availableAmount" float`);
  }

  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."liquidity_balance" DROP COLUMN "availableAmount"`);
  }
};
