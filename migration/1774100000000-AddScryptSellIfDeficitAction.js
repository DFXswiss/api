module.exports = class AddScryptSellIfDeficitAction1774100000000 {
  name = 'AddScryptSellIfDeficitAction1774100000000';

  async up(queryRunner) {
    // Create sell-if-deficit action: sells EUR for BTC only when Bitcoin on-chain has a deficit, falls back to existing EUR→USDT sell (action 233)
    await queryRunner.query(`
            INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "tag", "params", "onSuccessId", "onFailId")
            VALUES ('Scrypt', 'sell-if-deficit', 'SCRYPT EUR->BTC if deficit', '{"tradeAsset":"BTC","checkAssetId":113}', NULL, 233)
        `);

    // Update rule 313 (Scrypt/EUR) to use new action as redundancy start
    await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "redundancyStartActionId" = (
                SELECT "id" FROM "dbo"."liquidity_management_action"
                WHERE "system" = 'Scrypt' AND "command" = 'sell-if-deficit'
            )
            WHERE "id" = 313
        `);
  }

  async down(queryRunner) {
    // Restore rule 313 to original action (233 = sell EUR→USDT)
    await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "redundancyStartActionId" = 233
            WHERE "id" = 313
        `);

    // Remove sell-if-deficit action
    await queryRunner.query(`
            DELETE FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'Scrypt' AND "command" = 'sell-if-deficit'
        `);
  }
};
