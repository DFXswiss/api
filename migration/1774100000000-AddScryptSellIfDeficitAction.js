module.exports = class AddScryptSellIfDeficitAction1774100000000 {
  name = 'AddScryptSellIfDeficitAction1774100000000';

  async up(queryRunner) {
    // Skip if action 233 (onFail target) doesn't exist in this environment
    const [action] = await queryRunner.query(`SELECT "id" FROM "dbo"."liquidity_management_action" WHERE "id" = 233`);
    if (!action) return;

    await queryRunner.query(`
            INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "tag", "params", "onSuccessId", "onFailId")
            VALUES ('Scrypt', 'sell-if-deficit', 'SCRYPT BTC', '{"tradeAsset":"BTC","checkAssetId":113}', NULL, 233)
        `);

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
