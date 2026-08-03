/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds an integer optimistic-concurrency token for BuyCrypto writers. Unlike the `updated` timestamp,
 * this token round-trips through JavaScript without losing PostgreSQL microsecond precision.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBuyCryptoVersion1785584900000 {
  name = 'AddBuyCryptoVersion1785584900000';

  /** @param {QueryRunner} queryRunner */
  async up(queryRunner) {
    await queryRunner.query('ALTER TABLE "buy_crypto" ADD "version" integer NOT NULL DEFAULT 1');
    await queryRunner.query('ALTER TABLE "buy_crypto" ALTER COLUMN "version" DROP DEFAULT');
  }

  /** @param {QueryRunner} queryRunner */
  async down(queryRunner) {
    await queryRunner.query('ALTER TABLE "buy_crypto" DROP COLUMN "version"');
  }
};
