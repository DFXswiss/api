/**
 * Add optional dual-sided market columns on price_rule.
 *
 * sellPriceSource / currentSellPrice let a rule carry a separate sell quote (e.g. Denario bid)
 * alongside the existing buy quote (priceSource / currentPrice). priceTimestamp is shared: both
 * prices are written in the same update cycle.
 *
 * Pure schema — runs in every environment. No data mutation.
 *
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPriceRuleSellPrice1786300000000 {
  name = 'AddPriceRuleSellPrice1786300000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // character varying / double precision match the existing priceSource / currentPrice columns
    // on price_rule (see InitialSchema).
    await queryRunner.query(`ALTER TABLE "price_rule" ADD "sellPriceSource" character varying`);
    await queryRunner.query(`ALTER TABLE "price_rule" ADD "currentSellPrice" double precision`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "price_rule" DROP COLUMN "currentSellPrice"`);
    await queryRunner.query(`ALTER TABLE "price_rule" DROP COLUMN "sellPriceSource"`);
  }
};
