/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddPaymentLinkWebhookFailureTracking1783697064952 {
  name = 'AddPaymentLinkWebhookFailureTracking1783697064952';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "payment_link" ADD "webhookFailCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "payment_link" ADD "webhookLastFailedAt" TIMESTAMP`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "webhookLastFailedAt"`);
    await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "webhookFailCount"`);
  }
};
