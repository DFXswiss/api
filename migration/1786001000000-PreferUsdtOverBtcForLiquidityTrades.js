// Prefer USDT over BTC for Binance liquidity-management deficit buy chains.
//
// Context: Binance delisted / broke several */BTC markets (empty order book, status BREAK).
// The deficit chain historically tried BTC first (W --onFail--> B --onFail--> U --onFail--> T),
// so a TypeError on empty order books killed the pipeline instead of following the onFail path.
//
// A1 — Swap fail-order for 17 Binance buy pairs (BTC, USDT): USDT first, BTC as fallback.
//      Data-driven: discover W (onFailId = B) and T (U.onFailId); skip pairs whose B.onFailId != U.
//      Also re-point rules whose deficitStartActionId is B itself (non-WBTC) to U.
// A2 — WBTC keeps BTC first: clone W as W' (tag + ' WBTC', onFailId = B) and re-point only
//      deficitStartActionId for rules whose targetAsset is WBTC (and start at W). Rules that
//      start directly at B with target WBTC stay on B (already BTC-first; no W' for them).
// A3 — Deactivate all Active DAI rules: Binance has no DAI market left (both pairs BREAK), and all
//      DAI assets at DFX are buyable=false — no customer order can strand on DAI.
//
// Guards: missing actions/rules are skipped so lower environments without LM seed data no-op safely.
// down() reverses edges and deletes W' clones; DAI deactivation is intentionally not auto-reversed.

module.exports = class PreferUsdtOverBtcForLiquidityTrades1786001000000 {
  name = 'PreferUsdtOverBtcForLiquidityTrades1786001000000';

  // (BTC buy action id, USDT buy action id) — system=Binance, command=buy
  pairs = [
    [10, 13],
    [16, 17],
    [19, 20],
    [22, 23],
    [25, 26],
    [30, 31],
    [41, 42],
    [45, 46],
    [53, 54],
    [57, 58],
    [61, 62],
    [142, 143],
    [155, 156],
    [172, 173],
    [181, 182],
    [219, 220],
    [244, 245],
  ];

  async up(queryRunner) {
    for (const [btcId, usdtId] of this.pairs) {
      const [b] = await queryRunner.query(
        `SELECT "id", "onFailId" FROM "liquidity_management_action" WHERE "id" = ${btcId} AND "system" = 'Binance' AND "command" = 'buy'`,
      );
      const [u] = await queryRunner.query(
        `SELECT "id", "onFailId" FROM "liquidity_management_action" WHERE "id" = ${usdtId} AND "system" = 'Binance' AND "command" = 'buy'`,
      );
      if (!b || !u) continue;

      // Expected structure: B --onFail--> U; otherwise chain has moved — skip
      // Coerce: node-pg may return int columns as string
      if (Number(b.onFailId) !== Number(u.id)) continue;

      const tId = u.onFailId; // may be null

      // Discover W before edge swap — after swap U.onFailId = B, so a post-swap query would include U
      const ws = await queryRunner.query(
        `SELECT "id", "system", "command", "tag", "params", "onSuccessId", "onFailId"
         FROM "liquidity_management_action" WHERE "onFailId" = ${btcId}`,
      );

      // A1: U --onFail--> B --onFail--> T (edges once per pair)
      await queryRunner.query(
        `UPDATE "liquidity_management_action" SET "onFailId" = ${btcId} WHERE "id" = ${usdtId}`,
      );
      await queryRunner.query(
        tId == null
          ? `UPDATE "liquidity_management_action" SET "onFailId" = NULL WHERE "id" = ${btcId}`
          : `UPDATE "liquidity_management_action" SET "onFailId" = ${tId} WHERE "id" = ${btcId}`,
      );

      // A1: rules that start directly at B (non-WBTC) → start at U (USDT first).
      // WBTC rules that start at B stay on B (already BTC-first; no W' clone for them).
      await queryRunner.query(
        `UPDATE "liquidity_management_rule" SET "deficitStartActionId" = ${usdtId}
         WHERE "deficitStartActionId" = ${btcId}
           AND ("targetAssetId" IS NULL OR "targetAssetId" NOT IN (SELECT "id" FROM "asset" WHERE "name" = 'WBTC'))`,
      );

      // A1: every W that pointed at B now points at U; A2: WBTC W' clones for rules starting at W
      for (const w of ws) {
        await queryRunner.query(
          `UPDATE "liquidity_management_action" SET "onFailId" = ${usdtId} WHERE "id" = ${w.id}`,
        );

        // A2 — WBTC keeps BTC-first path via a cloned withdraw action W'
        const wbtcRules = await queryRunner.query(
          `SELECT r."id" FROM "liquidity_management_rule" r
           JOIN "asset" a ON a."id" = r."targetAssetId"
           WHERE r."deficitStartActionId" = ${w.id} AND a."name" = 'WBTC'`,
        );
        if (!wbtcRules.length) continue;

        const tag = w.tag == null ? 'WBTC' : `${w.tag} WBTC`;
        const paramsSql = w.params == null ? 'NULL' : `'${String(w.params).replace(/'/g, "''")}'`;
        const onSuccessSql = w.onSuccessId == null ? 'NULL' : String(w.onSuccessId);

        const inserted = await queryRunner.query(
          `INSERT INTO "liquidity_management_action" ("system", "command", "tag", "params", "onSuccessId", "onFailId")
           VALUES ('${String(w.system).replace(/'/g, "''")}', '${String(w.command).replace(/'/g, "''")}', '${tag.replace(/'/g, "''")}', ${paramsSql}, ${onSuccessSql}, ${btcId})
           RETURNING "id"`,
        );
        const wPrimeId = inserted[0].id;

        await queryRunner.query(
          `UPDATE "liquidity_management_rule" SET "deficitStartActionId" = ${wPrimeId}
           WHERE "deficitStartActionId" = ${w.id}
             AND "targetAssetId" IN (SELECT "id" FROM "asset" WHERE "name" = 'WBTC')`,
        );
      }
    }

    // A3 — DAI stilllegen (no Binance DAI market; DFX buyable=false on all DAI assets)
    await queryRunner.query(
      `UPDATE "liquidity_management_rule" SET "status" = 'Inactive'
       WHERE "targetAssetId" IN (SELECT "id" FROM "asset" WHERE "name" = 'DAI')
         AND "status" = 'Active'`,
    );
  }

  async down(queryRunner) {
    // A3 — Stilllegung wird bewusst nicht automatisch zurückgenommen: ohne gespeicherten
    // Vorzustand ist nicht unterscheidbar, welche Regeln die Migration deaktiviert hat.
    // Reaktivieren ist ein bewusster manueller Schritt. Fail-closed und harmlos, weil DFX
    // DAI ohnehin nicht anbietet (alle DAI-Assets buyable=false).

    for (const [btcId, usdtId] of this.pairs) {
      const [b] = await queryRunner.query(
        `SELECT "id", "onFailId" FROM "liquidity_management_action" WHERE "id" = ${btcId} AND "system" = 'Binance' AND "command" = 'buy'`,
      );
      const [u] = await queryRunner.query(
        `SELECT "id", "onFailId" FROM "liquidity_management_action" WHERE "id" = ${usdtId} AND "system" = 'Binance' AND "command" = 'buy'`,
      );
      if (!b || !u) continue;

      // Post-up structure: U --onFail--> B; otherwise not applied / already reversed — skip
      // Coerce: node-pg may return int columns as string
      if (Number(u.onFailId) !== Number(b.id)) continue;

      const tId = b.onFailId;

      // Find W: actions that currently fail over to U (post-up W --onFail--> U)
      const ws = await queryRunner.query(
        `SELECT "id", "system", "command", "tag", "params", "onSuccessId"
         FROM "liquidity_management_action" WHERE "onFailId" = ${usdtId}`,
      );

      for (const w of ws) {
        const expectedTag = w.tag == null ? 'WBTC' : `${w.tag} WBTC`;
        const wPrimes = await queryRunner.query(
          `SELECT "id" FROM "liquidity_management_action"
           WHERE "system" = '${String(w.system).replace(/'/g, "''")}'
             AND "command" = '${String(w.command).replace(/'/g, "''")}'
             AND "tag" = '${expectedTag.replace(/'/g, "''")}'
             AND "onFailId" = ${btcId}
             AND "onSuccessId" IS NOT DISTINCT FROM ${w.onSuccessId == null ? 'NULL' : w.onSuccessId}`,
        );

        for (const wPrime of wPrimes) {
          // Only rules whose deficitStartActionId is the W' clone — not B/U direct-start rules
          await queryRunner.query(
            `UPDATE "liquidity_management_rule" SET "deficitStartActionId" = ${w.id}
             WHERE "deficitStartActionId" = ${wPrime.id}`,
          );
          await queryRunner.query(`DELETE FROM "liquidity_management_action" WHERE "id" = ${wPrime.id}`);
        }

        // Restore W --onFail--> B
        await queryRunner.query(
          `UPDATE "liquidity_management_action" SET "onFailId" = ${btcId} WHERE "id" = ${w.id}`,
        );
      }

      // Reverse A1 direct-start rules: U → B (non-WBTC only). Exclusive to rules whose
      // deficitStartActionId is U itself — does not touch rules pointing at W / W'.
      await queryRunner.query(
        `UPDATE "liquidity_management_rule" SET "deficitStartActionId" = ${btcId}
         WHERE "deficitStartActionId" = ${usdtId}
           AND ("targetAssetId" IS NULL OR "targetAssetId" NOT IN (SELECT "id" FROM "asset" WHERE "name" = 'WBTC'))`,
      );

      // Restore B --onFail--> U --onFail--> T
      await queryRunner.query(
        `UPDATE "liquidity_management_action" SET "onFailId" = ${usdtId} WHERE "id" = ${btcId}`,
      );
      await queryRunner.query(
        tId == null
          ? `UPDATE "liquidity_management_action" SET "onFailId" = NULL WHERE "id" = ${usdtId}`
          : `UPDATE "liquidity_management_action" SET "onFailId" = ${tId} WHERE "id" = ${usdtId}`,
      );
    }
  }
};
