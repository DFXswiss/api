module.exports = class AddXtJusd1772841480000 {
  name = 'AddXtJusd1772841480000';

  async up(queryRunner) {
    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'XT/JUSD')
      INSERT INTO "dbo"."asset" (
        "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
        "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
        "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
        "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
      ) VALUES (
        'JUSD', 'Custody', 0, 0, NULL, 'JUSD', 'Private', 'XT', 'XT/JUSD', NULL,
        0, NULL, 0, 0, 0, 0, 0, 0,
        'USD', 0, 0, 0, 0, 40,
        1.0, 0.776106, 0.8597180000000001, NULL
      )
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'XT/JUSD'`);
  }
};
