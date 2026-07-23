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
 * Fachlich:
 *   - Reaktiviert die dormante Ethereum/ZCHF-Regel (context='Ethereum', target asset uniqueName
 *     'Ethereum/ZCHF'): status Inactive → Active, maximal 10000000 → 10000. Die Redundancy-Logik
 *     schiebt damit ZCHF-Überschuss oberhalb von maximal=10000 wieder Richtung optimal=100 (und
 *     damit Richtung MEXC).
 *   - Schaltet den MEXC→USDT-Abverkaufspfad scharf: Regel "308" (context='MEXC', uniqueName
 *     'MEXC/ZCHF') wechselt von einer reinen Observe-Regel (minimal/optimal/maximal alle NULL)
 *     auf minimal=0 / optimal=0 / maximal=500 mit sendNotifications=true. Die zugehörige
 *     redundancyStartAction (system='MEXC', command='sell') wird von reinem Verkauf
 *     (`{"tradeAsset":"USDT"}`) auf `{"tradeAsset":"USDT","liquidityLimited":true}` umgestellt.
 *
 * Werte-Herkunft:
 *   - maximal=10000 (Regel 170) ist der letzte belegte Live-Wert, rekonstruiert aus 12 historischen
 *     Redundancy-Orders, bei denen maxAmount − minAmount konstant 9900 war
 *     (bei optimal=100 ⇒ maximal = 100 + 9900 = 10000).
 *   - Regel-308-Werte (minimal=0, optimal=0, maximal=500) sind bewusst gesetzt, kein historischer
 *     Anker (Action 225 ist nie gelaufen). maximal=500 dient als Trigger-Floor deutlich über der
 *     MEXC-Mindestordergrösse, damit ein fehlgeschlagener Dust-Sell nicht über `handlePipelineFail`
 *     die gesamte Regel 308 pausiert und dadurch den produktiven Kauf-Pfad (Action 223, 846 Orders)
 *     mit lahmlegt.
 *   - `"liquidityLimited":true` auf der Sell-Action sorgt dafür, dass die grosse Erst-Abwicklung in
 *     Best-Price-Chunks statt als einzelner Market-Order über den 5%-Preis-Guard läuft — spiegelt
 *     die bestehende Kauf-Action 223.
 *
 * up() ist NICHT idempotent im Sinne eines Re-run-Schutzes über INSERT-ON-CONFLICT wie bei den
 * Frick-Migrationen. Die Preconditions in up() sind bewusst strikt (fail-loud bei jedem Zustand
 * ausser dem exakt erwarteten Ausgangszustand), damit ein versehentlicher zweiter Lauf sofort mit
 * Error abbricht statt die Werte ein zweites Mal zu verschieben.
 *
 * Der lock_timeout wird transaction-scoped via `SET LOCAL lock_timeout` gesetzt (konsistent mit den
 * Frick-Referenzmigrationen); TypeORM führt up()/down() jeweils in einer eigenen Transaktion aus.
 *
 * up():
 *   1. prod guard (no-op elsewhere)
 *   2. lock_timeout
 *   3. fail-loud precondition Regel 170 (Inactive, 0/100/10000000)
 *   4. UPDATE Regel 170 → Active, maximal=10000
 *   5. fail-loud precondition Regel 308 (Active, NULL/NULL/NULL, redundancyStartActionId gesetzt)
 *   6. UPDATE Regel 308 → 0/0/500, sendNotifications=true
 *   7. fail-loud precondition MEXC-Sell-Action (system=MEXC, command=sell)
 *   8. UPDATE Action params → tradeAsset=USDT, liquidityLimited=true
 *   9. fail-loud post-conditions für Regel 170 und 308
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

    // --- Precondition Regel 170 (Ethereum/ZCHF, dormant) ---
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

    // --- Precondition Regel 308 (MEXC/ZCHF, observe-only) ---
    const rule308 = (
      await queryRunner.query(`
        SELECT lmr."status", lmr."minimal", lmr."optimal", lmr."maximal", lmr."redundancyStartActionId"
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
      rule308.redundancyStartActionId == null
    ) {
      throw new Error(
        `Precondition failed for MEXC/ZCHF rule: expected status=Active, minimal/optimal/maximal=NULL, redundancyStartActionId set; got status=${rule308.status}, minimal=${rule308.minimal}, optimal=${rule308.optimal}, maximal=${rule308.maximal}, redundancyStartActionId=${rule308.redundancyStartActionId}`,
      );
    }

    await queryRunner.query(`
      UPDATE "liquidity_management_rule"
      SET "minimal" = 0, "optimal" = 0, "maximal" = 500, "sendNotifications" = true
      WHERE "context" = 'MEXC'
        AND "targetAssetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'MEXC/ZCHF')
        AND "targetFiatId" IS NULL
    `);

    // --- Precondition MEXC-Sell-Action (system + command only; params format may vary) ---
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
        SELECT lmr."status", lmr."minimal", lmr."optimal", lmr."maximal", lmr."redundancyStartActionId"
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
      Number(rule308After.maximal) !== 500
    ) {
      throw new Error(
        `Post-condition failed for MEXC/ZCHF rule: expected minimal=0, optimal=0, maximal=500; got minimal=${rule308After && rule308After.minimal}, optimal=${rule308After && rule308After.optimal}, maximal=${rule308After && rule308After.maximal}`,
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
