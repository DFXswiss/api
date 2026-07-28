// Add Unstoppable Wallet (Horizontal Systems) to the wallet_app table so it appears as a
// payment app on DFX OpenCryptoPay payment-link pages (app.dfx.swiss/pl).
//
// Unstoppable ships native OpenCryptoPay support on iOS and Android. It detects the standard
// OCP QR (https URL with lightning= LNURL query), decodes the LNURL and pays via its OCP
// broadcasters. Supported OCP transfer methods verified against the app sources on 2026-07-28:
// - iOS: OpenCryptoPayBroadcasterFactory.unstoppable registers EvmHex, Tron, Bitcoin, Solana,
//   Zano and MoneroHash broadcasters; their supportedChains maps yield the method names below.
// - Android: OcpTransferAmount.supportedBlockchainTypes() in OpenCryptoPayRepository.kt lists
//   the same eleven methods.
// Resulting blockchains: Ethereum, BinanceSmartChain, Polygon, Arbitrum, Optimism, Base,
// Bitcoin, Solana, Tron, Zano, Monero.
//
// EVM chains are listed explicitly instead of the EvmBlockchains placeholder: Unstoppable only
// OCP-broadcasts those six EVMs; Gnosis, Haqq, Citrea and CitreaTestnet from EvmBlockchains
// are not included. See WalletApp.supportedBlockchainList.
//
// Columns intentionally omitted so they stay at DB default / NULL:
// - recommended: normal wallet, not shown in the recommended block
// - semiCompatible: full native OCP support, not semi-compatible
// - assets: no asset restriction; arbitrary tokens on the listed chains
// - hasActionDeepLink: must stay NULL. That flag means a non-Lightning wallet accepts payment
//   via deepLink + lightning: + LNURL (see SetRealUnitHasActionDeepLink migration). For
//   Unstoppable that is wrong: OpenCryptoPayUrl.detect on iOS only accepts scheme https with a
//   lightning query; a unstoppable.money:lightning:... URL fails with the cannot-recognize
//   banner. Same behaviour as Cake Wallet flag NULL, not RealUnit.
//
// deepLink unstoppable.money: is a registered URL scheme on both platforms, so the frontend
// open-app action works. iconUrl already hosts on dfx.swiss and returns HTTP 200.
//
// down() ownership: DELETE matches name AND the characteristic values this migration wrote
// (deepLink + blockchains). A row that was hand-created or later edited with different
// values is not ours — up() would have skipped it via the SELECT guard — so a bare
// name-only DELETE would destroy foreign data on an up/down cycle. Same exact-value idiom as
// SetRealUnitHasActionDeepLink (and PopulateNativeCoinDecimals).

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class AddUnstoppableWalletApp1785400000000 {
  name = 'AddUnstoppableWalletApp1785400000000';

  async up(queryRunner) {
    // Idempotent guard against UNIQUE(name): skip if Unstoppable Wallet already exists.
    const existing = (await queryRunner.query(`SELECT "id" FROM "wallet_app" WHERE "name" = 'Unstoppable Wallet'`)).at(
      0,
    );
    if (existing) return;

    await queryRunner.query(
      `INSERT INTO "wallet_app" ("name", "websiteUrl", "iconUrl", "deepLink", "appStoreUrl", "playStoreUrl", "blockchains", "active") VALUES ('Unstoppable Wallet', 'https://unstoppable.money/', 'https://dfx.swiss/images/app/UnstoppableWallet.webp', 'unstoppable.money:', 'https://apps.apple.com/app/unstoppable-crypto-wallet/id1447619907', 'https://play.google.com/store/apps/details?id=io.horizontalsystems.bankwallet', 'Ethereum;BinanceSmartChain;Polygon;Arbitrum;Optimism;Base;Bitcoin;Solana;Tron;Zano;Monero', true)`,
    );
  }

  async down(queryRunner) {
    // Only remove the row this migration created. See header comment on ownership.
    await queryRunner.query(
      `DELETE FROM "wallet_app" WHERE "name" = 'Unstoppable Wallet' AND "deepLink" = 'unstoppable.money:' AND "blockchains" = 'Ethereum;BinanceSmartChain;Polygon;Arbitrum;Optimism;Base;Bitcoin;Solana;Tron;Zano;Monero'`,
    );
  }
};
