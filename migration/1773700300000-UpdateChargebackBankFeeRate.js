module.exports = class UpdateChargebackBankFeeRate1773700300000 {
  name = 'UpdateChargebackBankFeeRate1773700300000';

  async up(queryRunner) {
    await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "rate" = 0.01, "label" = 'Chargeback Bank Fee 1%'
            WHERE "id" = 112
        `);
  }

  async down(queryRunner) {
    await queryRunner.query(`
            UPDATE "dbo"."fee"
            SET "rate" = 0.001, "label" = 'Chargeback Bank Fee 0.1%'
            WHERE "id" = 112
        `);
  }
};
