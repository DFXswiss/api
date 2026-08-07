/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * #4673 - the Monero payout path builds and signs its transaction (`transfer` with do_not_relay) and
 * relays it in a second call, so the transaction id exists before anything is submitted. These two
 * columns hold it: "signedPayoutTxId" is the durable pre-relay id, "signedPayoutTxMetadata" the wallet
 * blob that `relay_tx` re-submits (same transaction, same id) instead of rebuilding a competing one.
 *
 * Both nullable and additive: every existing order and every other chain keeps them NULL and behaves
 * exactly as before. The metadata is hex of a few kB, hence text rather than a bounded varchar.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPayoutOrderSignedTx1785900000000 {
  name = 'AddPayoutOrderSignedTx1785900000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "signedPayoutTxId" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "signedPayoutTxMetadata" text`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "signedPayoutTxMetadata"`);
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "signedPayoutTxId"`);
  }
};
