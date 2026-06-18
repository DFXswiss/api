// Re-point userData 307373's primary wallet from "Edge" (id 67) to the default
// "DFX Wallet" (id 1). The Edge wallet disables the "Info" mail type via mailConfig,
// which silently suppresses the ACCOUNT_MERGE_REQUEST mail (classified as Info), so the
// pending account merge can never be confirmed. Re-pointing to a wallet without an Info
// opt-out lets the merge confirmation mail be delivered.
//
// Env-guarded: only the PROD row matches; on other environments this is a no-op.
// Verified on 2026-06-09: 307373."walletId" = 67, target wallet 1 has mailConfig = NULL.
module.exports = class RepointAccountWalletForMergeMail1780993625289 {
  name = 'RepointAccountWalletForMergeMail1780993625289';

  async up(queryRunner) {
    const accounts = await queryRunner.query(
      `SELECT "id" FROM "user_data" WHERE "id" = 307373 AND "walletId" = 67`,
    );
    if (!accounts.length) return;

    await queryRunner.query(`UPDATE "user_data" SET "walletId" = 1 WHERE "id" = 307373`);
  }

  async down(queryRunner) {
    const accounts = await queryRunner.query(
      `SELECT "id" FROM "user_data" WHERE "id" = 307373 AND "walletId" = 1`,
    );
    if (!accounts.length) return;

    await queryRunner.query(`UPDATE "user_data" SET "walletId" = 67 WHERE "id" = 307373`);
  }
};
