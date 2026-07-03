/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AlignOlkyFrozenWithOlkypayEur1783117568000 {
  name = 'AlignOlkyFrozenWithOlkypayEur1783117568000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Make the inert OlkyFrozen/EUR custody asset consistent with the existing Olkypay/EUR asset:
    //  1. adopt the same price rule + CHF/USD valuation, so approxPriceChf is maintained and the
    //     manually recorded frozen amount contributes to the CHF equity (totalBalanceChf).
    //  2. give it a liquidity_balance row (like Olkypay/EUR has), so the financial-log job does not
    //     skip it via its `balance?.amount == null && !isActive` guard. The frozen amount itself is
    //     maintained manually through the `balanceLogLiqPositions` setting and added on top by the job.
    // Asset ids are environment-specific, so everything is resolved via the stable uniqueName.

    const frozen = (
      await queryRunner.query(`SELECT "id", "priceRuleId" FROM "asset" WHERE "uniqueName" = 'OlkyFrozen/EUR'`)
    ).at(0);
    if (!frozen) return; // asset not present in this environment

    const olkypay = (
      await queryRunner.query(
        `SELECT "priceRuleId", "approxPriceChf", "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Olkypay/EUR'`,
      )
    ).at(0);

    // 1. adopt Olkypay/EUR's price rule + current CHF/USD valuation (only if not already set)
    if (frozen.priceRuleId == null && olkypay && olkypay.priceRuleId != null) {
      await queryRunner.query(
        `UPDATE "asset" SET "priceRuleId" = $1, "approxPriceChf" = $2, "approxPriceUsd" = $3 WHERE "id" = $4`,
        [olkypay.priceRuleId, olkypay.approxPriceChf, olkypay.approxPriceUsd, frozen.id],
      );
    }

    // 2. zero-amount, DFX-owned door-opener balance row (idempotent; no unique constraint on assetId)
    const existingBalance = (
      await queryRunner.query(`SELECT "id" FROM "liquidity_balance" WHERE "assetId" = $1`, [frozen.id])
    ).at(0);
    if (!existingBalance) {
      await queryRunner.query(
        `INSERT INTO "liquidity_balance" ("amount", "availableAmount", "isDfxOwned", "assetId") VALUES (0, 0, true, $1)`,
        [frozen.id],
      );
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    const frozen = (
      await queryRunner.query(`SELECT "id", "priceRuleId" FROM "asset" WHERE "uniqueName" = 'OlkyFrozen/EUR'`)
    ).at(0);
    if (!frozen) return;

    // Remove the zero-amount door-opener row this migration added.
    await queryRunner.query(`DELETE FROM "liquidity_balance" WHERE "assetId" = $1 AND "amount" = 0`, [frozen.id]);

    // Mirror up()'s guard: only revert the valuation if it still matches the rule adopted from
    // Olkypay/EUR (i.e. up() set it here). This avoids nulling a price rule that was already
    // present before this migration (e.g. seeded), keeping down() a faithful inverse of up().
    const olkypay = (
      await queryRunner.query(`SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Olkypay/EUR'`)
    ).at(0);
    if (olkypay && frozen.priceRuleId != null && frozen.priceRuleId === olkypay.priceRuleId) {
      await queryRunner.query(
        `UPDATE "asset" SET "priceRuleId" = NULL, "approxPriceChf" = NULL, "approxPriceUsd" = NULL WHERE "id" = $1`,
        [frozen.id],
      );
    }
  }
};
