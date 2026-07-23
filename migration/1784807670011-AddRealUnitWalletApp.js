// Add RealUnit as a selectable wallet_app for DFX OpenCryptoPay payment-link pages.
//
// Follows the AQUA wallet_app precedent: Lightning-only wallet with a bare custom-scheme
// deepLink ('realunit-wallet:') so the payment frontend can build Lightning links as
// "<deepLink>lightning:<lnurl>". assets is NULL (no asset filter); supportedAssets stays
// undefined in the API response when assets is null.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class AddRealUnitWalletApp1784807670011 {
  name = 'AddRealUnitWalletApp1784807670011';

  async up(queryRunner) {
    // Idempotent guard against UNIQUE(name): skip if RealUnit already exists.
    const existing = (await queryRunner.query(`SELECT "id" FROM "wallet_app" WHERE "name" = 'RealUnit'`)).at(0);
    if (existing) return;

    await queryRunner.query(
      `INSERT INTO "wallet_app" ("name", "websiteUrl", "iconUrl", "deepLink", "hasActionDeepLink", "appStoreUrl", "playStoreUrl", "recommended", "blockchains", "assets", "semiCompatible", "active") VALUES ('RealUnit', 'https://realunit.app', 'https://dfx.swiss/images/app/realunit.webp', 'realunit-wallet:', NULL, 'https://apps.apple.com/ch/app/realunit/id6759720010', 'https://play.google.com/store/apps/details?id=swiss.realunit.app', false, 'Lightning', NULL, NULL, true)`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "wallet_app" WHERE "name" = 'RealUnit'`);
  }
};
