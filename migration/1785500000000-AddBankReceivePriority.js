/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Schema-only migration: `bank.receivePriority` receiver tie-breaker column (backfilled to a
 * neutral default on every existing row). It deliberately never inserts, updates or deletes
 * `bank` rows — the only prior migration that ever did that (`1768943778000-AddYapealEurManualBank.js`)
 * was reverted because the row was already inserted manually (`f897b98a2`). Productive priority
 * values are an Ops decision set after deploy; the NOT-NULL DEFAULT 1000 keeps today's selection
 * unchanged (ties broken by ascending id, so Olkypay id 4 still beats Frick id 19).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankReceivePriority1785500000000 {
  name = 'AddBankReceivePriority1785500000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    // Receiver priority is a deliberate, operator-controlled tie-breaker: lower value tried first.
    // Every pre-existing bank row is backfilled to the neutral default (1000) so this column
    // changes nothing about today's deposit-target routing until Ops deliberately lowers a bank's
    // priority below the incumbent's.
    await queryRunner.query(`ALTER TABLE "bank" ADD "receivePriority" integer NOT NULL DEFAULT 1000`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "bank" DROP COLUMN "receivePriority"`);
  }
};
