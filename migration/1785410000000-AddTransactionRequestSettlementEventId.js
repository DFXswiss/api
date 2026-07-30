/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `transaction_request.settlementEventId` — the stable indexer `accountHistory.id` of the
 * on-chain transfer that settled this request. The RealUnit settlement job previously identified
 * consumed events by the pair (txHash, Math.floor(shares)) and counted them as a multiset
 * (PR #4454). That heuristic cannot distinguish two same-amount transfers in one batch
 * settlement tx; the indexer primary key can.
 *
 * The column is set once by the settlement job together with `settlementTxId` (kept for the
 * block explorer link). A partial unique index enforces that each history event settles at most
 * one request, so a matching bug cannot assign the same event twice. Its name is the one
 * TypeORM's DefaultNamingStrategy derives from table, column and WHERE clause, so a later schema
 * diff recognizes the index declared on the entity instead of proposing a drop/recreate.
 *
 * There is intentionally no backfill. Requests completed before this change recorded only the
 * settlement tx hash; which transfer event of a batch tx they consumed is no longer recoverable.
 * Inventing an event id would be worse than leaving them unset: the job in
 * `realunit-job.service.ts` treats rows without `settlementEventId` as legacy and blocks the
 * whole tx for that user (`legacyTxIds` / `getLegacySettlementTxIds()`) instead of guessing.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddTransactionRequestSettlementEventId1785410000000 {
  name = 'AddTransactionRequestSettlementEventId1785410000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "transaction_request" ADD "settlementEventId" character varying(256)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_5f35c62743bc1cb8919a615767" ON "transaction_request" ("settlementEventId") WHERE "settlementEventId" IS NOT NULL`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_5f35c62743bc1cb8919a615767"`);
    await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "settlementEventId"`);
  }
};
