// Activate automatic Scrypt/BTC withdrawal to Bitcoin output wallet.
// When sell-if-deficit (Action 261) sells EUR→BTC on Scrypt, the BTC stays on Scrypt
// with no automatic way to move it to the Bitcoin output wallet. This adds:
// 1. A Scrypt withdraw action for BTC → Bitcoin wallet
// 2. Activates Rule 314 (Scrypt/BTC) with max 0.1 BTC to trigger redundancy withdrawals
module.exports = class ActivateScryptBtcWithdraw1775745823000 {
  name = 'ActivateScryptBtcWithdraw1775745823000';

  async up(queryRunner) {
    // Skip if Rule 314 doesn't exist in this environment
    const [rule] = await queryRunner.query(`SELECT "id" FROM "dbo"."liquidity_management_rule" WHERE "id" = 314`);
    if (!rule) return;

    // 1. Create Scrypt BTC withdraw action (same pattern as Action 231 for USDT)
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "tag", "params", "onSuccessId", "onFailId")
      VALUES ('Scrypt', 'withdraw', 'SCRYPT BTC', '{"destinationAddress":"BTC_OUT_WALLET_ADDRESS","destinationBlockchain":"Bitcoin","asset":"BTC"}', NULL, NULL)
    `);

    // 2. Activate Rule 314 with the new withdraw action as redundancy handler
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Active',
          "minimal" = 0,
          "optimal" = 0,
          "maximal" = 0.1,
          "redundancyStartActionId" = (
            SELECT "id" FROM "dbo"."liquidity_management_action"
            WHERE "system" = 'Scrypt' AND "command" = 'withdraw' AND "tag" = 'SCRYPT BTC'
          ),
          "updated" = GETDATE()
      WHERE "id" = 314
    `);
  }

  async down(queryRunner) {
    // Deactivate Rule 314
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Inactive',
          "minimal" = NULL,
          "optimal" = NULL,
          "maximal" = NULL,
          "redundancyStartActionId" = NULL,
          "updated" = GETDATE()
      WHERE "id" = 314
    `);

    // Remove Scrypt BTC withdraw action
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_action"
      WHERE "system" = 'Scrypt' AND "command" = 'withdraw' AND "tag" = 'SCRYPT BTC'
    `);
  }
};
