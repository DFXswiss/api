/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `buy_crypto.scorechainScreeningId`: links a high-risk buy-crypto tx to the exact Scorechain
 * screening that produced its verdict, so a later compliance release can bind an address exemption
 * to that reviewed screening instead of guessing by address history.
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBuyCryptoScorechainScreeningId1786122000000 {
  name = 'AddBuyCryptoScorechainScreeningId1786122000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "scorechainScreeningId" integer`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Unguarded on purpose: losing this link on rollback is harmless — the pre-migration code never
    // reads this column.
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "scorechainScreeningId"`);
  }
};
