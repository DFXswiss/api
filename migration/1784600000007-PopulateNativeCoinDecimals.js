/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 3). Sets asset.decimals for the three NON-EVM native COINs —
 * Solana SOL (9), Monero XMR (12), Zano ZANO (12) — so the exact base-unit capture built at deposit ingestion
 * (the monero/zano/solana register strategies -> PayInEntry.amountBaseUnits) actually runs. Those strategies scale the
 * exact whole-unit decimal captured on-chain via fromDecimalString(amountExact, asset.decimals); with decimals NULL
 * that call returns undefined (fail-open) and the ledger instead derives an 8-dp-capped value from the float, dropping
 * the 9th–12th on-chain decimal. Setting the native scale activates the >8-dp exact capture.
 *
 * WHY these were NULL: the ONLY automated decimals populator, EvmDecimalsService, filters blockchain IN EvmBlockchains,
 * so it never touches non-EVM native coins. The tokens on these chains and the BTC/EVM coins were populated elsewhere;
 * these three native coins were simply never populated. NULL here is unset DATA, not a coded assumption — no code path
 * keys off "decimals IS NULL" for these assets. The float amount / deposit-detection / min-deposit paths use each
 * chain's OWN fixed scale (Monero auToXmr 10^12, Zano ZANO_DECIMALS 12, Solana lamports 9), never asset.decimals, so
 * the booked float amount and deposit detection are unchanged; only the additive amountBaseUnits column is affected.
 * The exact-capture code is fail-open by design (see solana.util.spec: a COIN is captured only at decimals === 9).
 *
 * Idempotent: WHERE decimals IS NULL, so a re-run touches nothing and an already-set value is never overwritten.
 * Precise identification by name + blockchain + type = 'Coin' (the same triple AssetService resolves each coin by).
 *
 * Verified on: a throwaway Postgres 16 — the three UPDATEs set exactly the intended rows, leave same-name coins on
 * other chains and the chains' tokens untouched, and are no-ops on re-run. Runs at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PopulateNativeCoinDecimals1784600000007 {
  name = 'PopulateNativeCoinDecimals1784600000007';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "asset" SET "decimals" = 9 WHERE "name" = 'SOL' AND "blockchain" = 'Solana' AND "type" = 'Coin' AND "decimals" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "asset" SET "decimals" = 12 WHERE "name" = 'XMR' AND "blockchain" = 'Monero' AND "type" = 'Coin' AND "decimals" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "asset" SET "decimals" = 12 WHERE "name" = 'ZANO' AND "blockchain" = 'Zano' AND "type" = 'Coin' AND "decimals" IS NULL`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Revert ONLY the exact values this migration set, and only for the three precisely-identified native coins, so a
    // decimals value written by anything else is never clobbered on a rollback.
    await queryRunner.query(
      `UPDATE "asset" SET "decimals" = NULL WHERE "name" = 'SOL' AND "blockchain" = 'Solana' AND "type" = 'Coin' AND "decimals" = 9`,
    );
    await queryRunner.query(
      `UPDATE "asset" SET "decimals" = NULL WHERE "name" = 'XMR' AND "blockchain" = 'Monero' AND "type" = 'Coin' AND "decimals" = 12`,
    );
    await queryRunner.query(
      `UPDATE "asset" SET "decimals" = NULL WHERE "name" = 'ZANO' AND "blockchain" = 'Zano' AND "type" = 'Coin' AND "decimals" = 12`,
    );
  }
};
