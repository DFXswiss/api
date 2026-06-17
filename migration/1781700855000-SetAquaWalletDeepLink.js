// Set the AQUA wallet deep link prefix in the wallet_app table.
//
// Background: AQUA (JAN3) now registers the custom URI scheme "aqua:" (alongside bitcoin:,
// lightning:, liquidnetwork:). Its deep link handler treats "aqua:" as a wrapper scheme that
// strips the "aqua:" prefix and recursively re-parses the remainder, so it expects
// "aqua:<inner-scheme>:<payload>" (e.g. "aqua:lightning:<lnurl>").
//
// The wallet_app row had deepLink = NULL, which broke the payment frontend
// (@dfx.swiss/services-react): for public payments wallets without a deepLink are filtered out
// (AQUA was hidden), and otherwise the Lightning link builder produced a broken
// "null" + "lightning:" + <lnurl> string. The frontend builds Lightning links generically as
// "<deepLink>lightning:<lnurl>", so setting deepLink = 'aqua:' yields "aqua:lightning:<lnurl>",
// exactly the format AQUA expects. No frontend change is required; hasActionDeepLink is computed
// client-side and stays NULL like all other wallets.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class SetAquaWalletDeepLink1781700855000 {
  name = 'SetAquaWalletDeepLink1781700855000';

  async up(queryRunner) {
    await queryRunner.query(`UPDATE "wallet_app" SET "deepLink" = 'aqua:' WHERE "name" = 'AQUA' AND "deepLink" IS NULL`);
  }

  async down(queryRunner) {
    await queryRunner.query(`UPDATE "wallet_app" SET "deepLink" = NULL WHERE "name" = 'AQUA' AND "deepLink" = 'aqua:'`);
  }
};
