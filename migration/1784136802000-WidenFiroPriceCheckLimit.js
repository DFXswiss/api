// Widen the FIRO price rule's cross-check tolerance from 1% to 2%.
//
// The rule verifies the primary price against a reference exchange and rejects the refresh
// when both diverge by more than the limit. For this thinly traded pair the two sources
// routinely drift further apart than 1%, so refreshes keep getting rejected and the stored
// price ages past its validity window, failing dependent price lookups. 2% matches the
// pair's typical cross-venue spread while still rejecting clearly wrong quotes.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class WidenFiroPriceCheckLimit1784136802000 {
  name = 'WidenFiroPriceCheckLimit1784136802000';

  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "price_rule" SET "check1Limit" = 0.02, "updated" = NOW() WHERE "id" = 66 AND "check1Asset" = 'FIRO' AND "check1Limit" < 0.02`,
    );
  }

  async down(_queryRunner) {
    // Intentionally empty: restoring the tighter limit would re-break price refreshes;
    // a future tightening needs its own explicit migration.
  }
};
