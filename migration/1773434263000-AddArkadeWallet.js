module.exports = class AddArkadeWallet1773434263000 {
  name = 'AddArkadeWallet1773434263000';

  async up(queryRunner) {
    await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."wallet" WHERE "name" = 'Arkade')
            INSERT INTO "dbo"."wallet" (
                "name", "isKycClient", "amlRules", "autoTradeApproval",
                "mailConfig", "usesDummyAddresses", "displayFraudWarning", "buySpecificIbanEnabled"
            ) VALUES (
                'Arkade', 0, '0', 1,
                'BuyCrypto;BuyFiat;RefReward;Info', 0, 0, 0
            )
        `);
  }

  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "dbo"."wallet" WHERE "name" = 'Arkade'`);
  }
};
