/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds the nullable `bank.receivePriority` deposit-target eligibility and ordering column. This
 * migration deliberately updates existing `bank` rows to backfill the new column (without inserting
 * or deleting rows), because leaving every bank at NULL would make every deposit target ineligible
 * and change customer routing at deploy. Production activation of Frick by giving it a real priority
 * instead of NULL is a separate, later Ops data step and is not part of this migration.
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
    await queryRunner.query(`ALTER TABLE "bank" ADD "receivePriority" integer`);
    // Freeze today's behaviour exactly: every bank that the name-based filter already allowed as a
    // deposit target becomes eligible at the neutral default, and the one it excluded stays NULL
    // (= not eligible) until Ops deliberately assigns it a priority. The literal mirrors the removed
    // `b.name !== IbanBankName.FRICK` check one-to-one, including the fact that it never matched the
    // renamed legacy rows - those are receive=false and therefore were, and remain, unreachable.
    await queryRunner.query(`UPDATE "bank" SET "receivePriority" = 1000 WHERE "name" <> 'Bank Frick'`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "bank" DROP COLUMN "receivePriority"`);
  }
};
