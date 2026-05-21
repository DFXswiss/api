// Stop buying BTC directly on Scrypt. Convert incoming EUR on Scrypt to USDT instead
// and route USDT to Binance for further BTC acquisition (same pattern as CHF / Rule 312).
//
// Reverts the routing introduced by migration 1774100000000-AddScryptSellIfDeficitAction.js:
// 1. Re-points Rule 313 (Scrypt/EUR redundancy) from Action 261 back to Action 233
//    (Scrypt sell USDT) — already in use by Rule 312 (CHF) and known good.
// 2. Removes Action 261 (Scrypt sell-if-deficit BTC), which is no longer referenced.
//
// Verified on 2026-05-21: no other action references 261 via onSuccessId/onFailId.
// Rule 314 (Scrypt/BTC withdraw) is kept as cleanup path for any residual BTC on Scrypt.
module.exports = class RouteScryptEurViaUsdt1779381590531 {
  name = 'RouteScryptEurViaUsdt1779381590531';

  async up(queryRunner) {
    // Skip if rule 313 or action 233 don't exist in this environment
    const [rule] = await queryRunner.query(`SELECT "id" FROM "dbo"."liquidity_management_rule" WHERE "id" = 313`);
    if (!rule) return;

    const [fallbackAction] = await queryRunner.query(
      `SELECT "id" FROM "dbo"."liquidity_management_action" WHERE "id" = 233`,
    );
    if (!fallbackAction) return;

    // 1. Point Rule 313 (Scrypt/EUR redundancy) at the USDT sell action
    await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "redundancyStartActionId" = 233
            WHERE "id" = 313
        `);

    // 2. Remove the now-unreferenced sell-if-deficit BTC action
    await queryRunner.query(`
            DELETE FROM "dbo"."liquidity_management_action"
            WHERE "id" = 261 AND "system" = 'Scrypt' AND "command" = 'sell-if-deficit'
        `);
  }

  async down(queryRunner) {
    // Restore the state from migration 1774100000000-AddScryptSellIfDeficitAction.js:
    // re-insert Action 261 (Scrypt sell-if-deficit BTC) and re-point Rule 313 at it.
    const [fallbackAction] = await queryRunner.query(
      `SELECT "id" FROM "dbo"."liquidity_management_action" WHERE "id" = 233`,
    );
    if (!fallbackAction) return;

    await queryRunner.query(`
            SET IDENTITY_INSERT "dbo"."liquidity_management_action" ON;
            INSERT INTO "dbo"."liquidity_management_action" ("id", "system", "command", "tag", "params", "onSuccessId", "onFailId")
            VALUES (261, 'Scrypt', 'sell-if-deficit', 'SCRYPT BTC', '{"tradeAsset":"BTC","checkAssetId":113}', NULL, 233);
            SET IDENTITY_INSERT "dbo"."liquidity_management_action" OFF;
        `);

    await queryRunner.query(`
            UPDATE "dbo"."liquidity_management_rule"
            SET "redundancyStartActionId" = 261
            WHERE "id" = 313
        `);
  }
};
