// Add RealUnit as a selectable wallet_app for DFX OpenCryptoPay payment-link pages.
//
// RealUnit consumes the OpenCryptoPay LNURL only as the payment-request identifier and
// settles exclusively on-chain in ZCHF on Ethereum. blockchains='Ethereum' + assets='251'
// (Ethereum/ZCHF) yield supportedMethods=['Ethereum'] / supportedAssets=[Ethereum/ZCHF],
// so it qualifies for the Ethereum/ZCHF transfer option of an OCP payment (frontend matches
// on supportedAsset.name === 'ZCHF'). deepLink stays the bare custom scheme 'realunit-wallet:'.

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
      `INSERT INTO "wallet_app" ("name", "websiteUrl", "iconUrl", "deepLink", "hasActionDeepLink", "appStoreUrl", "playStoreUrl", "recommended", "blockchains", "assets", "semiCompatible", "active") VALUES ('RealUnit', 'https://realunit.app', 'https://dfx.swiss/images/app/realunit.webp', 'realunit-wallet:', NULL, 'https://apps.apple.com/ch/app/realunit/id6759720010', 'https://play.google.com/store/apps/details?id=swiss.realunit.app', false, 'Ethereum', '251', NULL, true)`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "wallet_app" WHERE "name" = 'RealUnit'`);
  }
};
