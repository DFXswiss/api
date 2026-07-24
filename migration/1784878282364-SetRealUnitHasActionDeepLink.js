// Set hasActionDeepLink = true for the RealUnit wallet_app row.
//
// Background: the DFX /pl frontend now uses wallet_app.hasActionDeepLink = true as the
// GENERIC (name-free) signal that a non-Lightning wallet takes the OCP payment via its
// <deepLink>lightning:<LNURL> action deeplink and shows the "Pay in app" label. RealUnit is
// such a wallet. The initial AddRealUnitWalletApp migration inserted the row with
// hasActionDeepLink = NULL, so this follow-up sets the flag. The IS NULL guard keeps the
// update idempotent and non-destructive of a manually-set value.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class SetRealUnitHasActionDeepLink1784878282364 {
  name = 'SetRealUnitHasActionDeepLink1784878282364';

  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "wallet_app" SET "hasActionDeepLink" = true WHERE "name" = 'RealUnit' AND "hasActionDeepLink" IS NULL`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(
      `UPDATE "wallet_app" SET "hasActionDeepLink" = NULL WHERE "name" = 'RealUnit' AND "hasActionDeepLink" = true`,
    );
  }
};
