module.exports = class AddEurBankPercentFee1773700400000 {
  name = 'AddEurBankPercentFee1773700400000';

  async up(queryRunner) {
    await queryRunner.query(`
            INSERT INTO "dbo"."fee" ("label", "type", "rate", "fixed", "blockchainFactor", "payoutRefBonus", "active", "fiats")
            VALUES ('Bank Fee EUR 0.5%', 'Bank', 0.005, 0, 1, 1, 1, '2')
        `);
  }

  async down(queryRunner) {
    await queryRunner.query(`
            DELETE FROM "dbo"."fee" WHERE "label" = 'Bank Fee EUR 0.5%' AND "type" = 'Bank'
        `);
  }
};
