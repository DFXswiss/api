/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PROD-ONLY data migration that reactivates the dormant Ethereum/ZCHF liquidity-management rule
 * (rule "170") and arms the MEXC ZCHF sell path (rule "308" + its MEXC sell action).
 *
 * Guarded to `ENVIRONMENT === 'prd'` for the same reason as the Bank Frick data migrations: an
 * active fund-moving LiquidityManagementRule would make the EVERY_MINUTE liquidity cron fail every
 * minute on dev/loc/CI (no MEXC / DEX credentials there). On those environments this migration is a
 * complete no-op; returning early still records the migration as executed, which is the intended
 * lower-env behaviour.
 *
 * What it does:
 *   - Reactivates the dormant Ethereum/ZCHF rule (context='Ethereum', target asset uniqueName
 *     'Ethereum/ZCHF'): status Inactive -> Active, maximal 10000000 -> 10000. The redundancy branch
 *     then offloads ZCHF held above maximal=10000 back down towards optimal=100 (i.e. towards MEXC).
 *   - Arms the MEXC -> USDT sell path: rule "308" (context='MEXC', uniqueName 'MEXC/ZCHF') moves from
 *     an observe-only rule (minimal/optimal/maximal all NULL) to minimal=0 / optimal=0 / maximal=500
 *     with sendNotifications=true. Its redundancyStartAction (system='MEXC', command='sell') is
 *     switched from a plain sell (`{"tradeAsset":"USDT"}`) to
 *     `{"tradeAsset":"USDT","liquidityLimited":true}`.
 *
 * Where the values come from:
 *   - maximal=10000 (rule 170) is the last operational value, reconstructed from the 12 historical
 *     redundancy orders whose maxAmount - minAmount was a constant 9900 (at optimal=100 => maximal =
 *     100 + 9900 = 10000).
 *   - The rule-308 values (minimal=0, optimal=0, maximal=500) are deliberately chosen; there is no
 *     historical anchor (the sell action has never run). maximal=500 acts as a trigger floor well
 *     above the MEXC minimum order size, so a failed dust sell cannot pause the whole rule 308 (via
 *     handlePipelineFail) and take the productive buy path (action 223, 846 orders) down with it.
 *   - `"liquidityLimited":true` on the sell action makes the large initial offload sell in
 *     best-price chunks instead of a single market order tripping the 5% price guard - mirroring the
 *     existing buy action 223.
 *
 * up() is NOT idempotent via INSERT-ON-CONFLICT like the Frick migrations. Its preconditions are
 * deliberately strict (fail-loud on any state other than the exact expected starting state), so an
 * accidental second run aborts with an Error instead of shifting the values a second time.
 *
 * The lock_timeout is set transaction-scoped via `SET LOCAL lock_timeout` (consistent with the Frick
 * reference migrations); TypeORM runs up()/down() each inside its own transaction.
 *
 * up():
 *   1. prod guard (no-op elsewhere)
 *   2. lock_timeout
 *   3. fail-loud precondition rule 170 (Inactive, 0/100/10000000)
 *   4. UPDATE rule 170 -> Active, maximal=10000
 *   5. fail-loud precondition rule 308 (Active, NULL/NULL/NULL, sendNotifications=false,
 *      redundancyStartActionId set)
 *   6. UPDATE rule 308 -> 0/0/500, sendNotifications=true
 *   7. fail-loud precondition MEXC sell action (system=MEXC, command=sell)
 *   8. UPDATE action params -> tradeAsset=USDT, liquidityLimited=true
 *   9. fail-loud post-conditions for rule 170 and rule 308
 *
 * down() reverses rules and action params (no preconditions), prod-guarded the same way.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ReactivateEthZchfLiquidityAndEnableMexcZchfSell1784700000000 {
  name = 'ReactivateEthZchfLiquidityAndEnableMexcZchfSell1784700000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Active fund-moving LM rules must NEVER run on dev/loc/CI — no MEXC/DEX credentials there, so
    // the EVERY_MINUTE liquidity cron would fail every minute. Returning early still records the
    // migration as executed, which is the intended no-op on lower environments.
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // --- Precondition rule 170 (Ethereum/ZCHF, dormant) ---
    const rule170 = (
      await queryRunner.query(`
        SELECT lmr."status", lmr."minimal", lmr."optimal", lmr."maximal"
        FROM "liquidity_management_rule" lmr
        JOIN "asset" a ON a."id" = lmr."targetAssetId"
        WHERE lmr."context" = 'Ethereum'
          AND a."uniqueName" = 'Ethereum/ZCHF'
          AND lmr."targetFiatId" IS NULL
      `)
    ).at(0);
    if (!rule170) {
      throw new Error(
        'Precondition failed: Ethereum/ZCHF liquidity rule (context=Ethereum, uniqueName=Ethereum/ZCHF) not found',
      );
    }
    if (
      rule170.status !== 'Inactive' ||
      Number(rule170.minimal) !== 0 ||
      Number(rule170.optimal) !== 100 ||
      Number(rule170.maximal) !== 10000000
    ) {
      throw new Error(
        `Precondition failed for Ethereum/ZCHF rule: expected status=Inactive, minimal=0, optimal=100, maximal=10000000; got status=${rule170.status}, minimal=${rule170.minimal}, optimal=${rule170.optimal}, maximal=${rule170.maximal}`,
      );
    }

    await queryRunner.query(`
      UPDATE "liquidity_management_rule"
      SET "status" = 'Active', "maximal" = 10000
      WHERE "context" = 'Ethereum'
        AND "targetAssetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF')
        AND "targetFiatId" IS NULL
    `);

    // --- Precondition rule 308 (MEXC/ZCHF, observe-only) ---
    const rule308 = (
      await queryRunner.query(`
        SELECT lmr."status", lmr."minimal", lmr."optimal", lmr."maximal", lmr."sendNotifications", lmr."redundancyStartActionId"
        FROM "liquidity_management_rule" lmr
        JOIN "asset" a ON a."id" = lmr."targetAssetId"
        WHERE lmr."context" = 'MEXC'
          AND a."uniqueName" = 'MEXC/ZCHF'
          AND lmr."targetFiatId" IS NULL
      `)
    ).at(0);
    if (!rule308) {
      throw new Error(
        'Precondition failed: MEXC/ZCHF liquidity rule (context=MEXC, uniqueName=MEXC/ZCHF) not found',
      );
    }
    if (
      rule308.status !== 'Active' ||
      rule308.minimal !== null ||
      rule308.optimal !== null ||
      rule308.maximal !== null ||
      rule308.sendNotifications !== false ||
      rule308.redundancyStartActionId == null
    ) {
      throw new Error(
        `Precondition failed for MEXC/ZCHF rule: expected status=Active, minimal/optimal/maximal=NULL, sendNotifications=false, redundancyStartActionId set; got status=${rule308.status}, minimal=${rule308.minimal}, optimal=${rule308.optimal}, maximal=${rule308.maximal}, sendNotifications=${rule308.sendNotifications}, redundancyStartActionId=${rule308.redundancyStartActionId}`,
      );
    }

    await queryRunner.query(`
      UPDATE "liquidity_management_rule"
      SET "minimal" = 0, "optimal" = 0, "maximal" = 500, "sendNotifications" = true
      WHERE "context" = 'MEXC'
        AND "targetAssetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'MEXC/ZCHF')
        AND "targetFiatId" IS NULL
    `);

    // --- Precondition MEXC sell action (system + command only; params format may vary) ---
    const sellAction = (
      await queryRunner.query(`
        SELECT "id", "system", "command"
        FROM "liquidity_management_action"
        WHERE "id" = (SELECT lmr."redundancyStartActionId" FROM "liquidity_management_rule" lmr JOIN "asset" a ON a."id" = lmr."targetAssetId" WHERE lmr."context" = 'MEXC' AND a."uniqueName" = 'MEXC/ZCHF' AND lmr."targetFiatId" IS NULL)
      `)
    ).at(0);
    if (!sellAction) {
      throw new Error(
        'Precondition failed: MEXC/ZCHF redundancyStartAction not found on liquidity_management_action',
      );
    }
    if (sellAction.system !== 'MEXC' || sellAction.command !== 'sell') {
      throw new Error(
        `Precondition failed for MEXC/ZCHF sell action: expected system=MEXC, command=sell; got system=${sellAction.system}, command=${sellAction.command}`,
      );
    }

    await queryRunner.query(`
      UPDATE "liquidity_management_action"
      SET "params" = '{"tradeAsset":"USDT","liquidityLimited":true}'
      WHERE "id" = (SELECT lmr."redundancyStartActionId" FROM "liquidity_management_rule" lmr JOIN "asset" a ON a."id" = lmr."targetAssetId" WHERE lmr."context" = 'MEXC' AND a."uniqueName" = 'MEXC/ZCHF' AND lmr."targetFiatId" IS NULL)
    `);

    // --- Post-conditions ---
    const rule170After = (
      await queryRunner.query(`
        SELECT lmr."status", lmr."minimal", lmr."optimal", lmr."maximal"
        FROM "liquidity_management_rule" lmr
        JOIN "asset" a ON a."id" = lmr."targetAssetId"
        WHERE lmr."context" = 'Ethereum'
          AND a."uniqueName" = 'Ethereum/ZCHF'
          AND lmr."targetFiatId" IS NULL
      `)
    ).at(0);
    if (!rule170After || rule170After.status !== 'Active' || Number(rule170After.maximal) !== 10000) {
      throw new Error(
        `Post-condition failed for Ethereum/ZCHF rule: expected status=Active, maximal=10000; got status=${rule170After && rule170After.status}, maximal=${rule170After && rule170After.maximal}`,
      );
    }

    const rule308After = (
      await queryRunner.query(`
        SELECT lmr."status", lmr."minimal", lmr."optimal", lmr."maximal", lmr."sendNotifications", lmr."redundancyStartActionId"
        FROM "liquidity_management_rule" lmr
        JOIN "asset" a ON a."id" = lmr."targetAssetId"
        WHERE lmr."context" = 'MEXC'
          AND a."uniqueName" = 'MEXC/ZCHF'
          AND lmr."targetFiatId" IS NULL
      `)
    ).at(0);
    if (
      !rule308After ||
      Number(rule308After.minimal) !== 0 ||
      Number(rule308After.optimal) !== 0 ||
      Number(rule308After.maximal) !== 500 ||
      rule308After.sendNotifications !== true
    ) {
      throw new Error(
        `Post-condition failed for MEXC/ZCHF rule: expected minimal=0, optimal=0, maximal=500, sendNotifications=true; got minimal=${rule308After && rule308After.minimal}, optimal=${rule308After && rule308After.optimal}, maximal=${rule308After && rule308After.maximal}, sendNotifications=${rule308After && rule308After.sendNotifications}`,
      );
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`
      UPDATE "liquidity_management_action"
      SET "params" = '{"tradeAsset":"USDT"}'
      WHERE "id" = (SELECT lmr."redundancyStartActionId" FROM "liquidity_management_rule" lmr JOIN "asset" a ON a."id" = lmr."targetAssetId" WHERE lmr."context" = 'MEXC' AND a."uniqueName" = 'MEXC/ZCHF' AND lmr."targetFiatId" IS NULL)
    `);

    await queryRunner.query(`
      UPDATE "liquidity_management_rule"
      SET "minimal" = NULL, "optimal" = NULL, "maximal" = NULL, "sendNotifications" = false
      WHERE "context" = 'MEXC'
        AND "targetAssetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'MEXC/ZCHF')
        AND "targetFiatId" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "liquidity_management_rule"
      SET "status" = 'Inactive', "maximal" = 10000000
      WHERE "context" = 'Ethereum'
        AND "targetAssetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF')
        AND "targetFiatId" IS NULL
    `);
  }
};
