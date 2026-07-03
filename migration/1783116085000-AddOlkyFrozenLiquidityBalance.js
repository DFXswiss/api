/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddOlkyFrozenLiquidityBalance1783116085000 {
  name = 'AddOlkyFrozenLiquidityBalance1783116085000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Resolve the env-specific asset id via the stable uniqueName (asset ids differ per environment).
    const asset = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'OlkyFrozen/EUR'`)).at(0);
    if (!asset) return;

    // Idempotent: skip if this asset already has a liquidity balance row
    // (no unique constraint exists on liquidity_balance.assetId, so guard explicitly).
    const existing = (
      await queryRunner.query(`SELECT "id" FROM "liquidity_balance" WHERE "assetId" = $1`, [asset.id])
    ).at(0);
    if (existing) return;

    // Zero-amount, DFX-owned balance row. It exists solely so the financial-log job
    // (log-job.service.ts) does not skip this inert asset via its
    // `balance?.amount == null && !isActive` guard. The actual frozen amount is maintained
    // manually through the `balanceLogLiqPositions` setting and added on top by the job.
    await queryRunner.query(
      `INSERT INTO "liquidity_balance" ("amount", "availableAmount", "isDfxOwned", "assetId") VALUES (0, 0, true, $1)`,
      [asset.id],
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    const asset = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'OlkyFrozen/EUR'`)).at(0);
    if (!asset) return;

    await queryRunner.query(`DELETE FROM "liquidity_balance" WHERE "assetId" = $1 AND "amount" = 0`, [asset.id]);
  }
};
