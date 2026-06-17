// Fix the AQUA wallet website URL in the wallet_app table.
//
// Background: the AQUA wallet (JAN3, package io.aquawallet.android / AppStore id6468594241) moved
// its website from the now-defunct aquawallet.io domain to aqua.net. The wallet_app row still
// pointed at https://aquawallet.io/, which no longer resolves (connection refused), while the
// public ecosystem page already links to https://aqua.net. This aligns the API data with the
// live domain.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class UpdateAquaWalletWebsiteUrl1781700412000 {
  name = 'UpdateAquaWalletWebsiteUrl1781700412000';

  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "wallet_app" SET "websiteUrl" = 'https://aqua.net/' WHERE "name" = 'AQUA' AND "websiteUrl" = 'https://aquawallet.io/'`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(
      `UPDATE "wallet_app" SET "websiteUrl" = 'https://aquawallet.io/' WHERE "name" = 'AQUA' AND "websiteUrl" = 'https://aqua.net/'`,
    );
  }
};
