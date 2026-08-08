/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportMessageReplySuggestion1786169975000 {
  name = 'AddSupportMessageReplySuggestion1786169975000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "support_message" ADD "suggestionText" text`);
    await queryRunner.query(`ALTER TABLE "support_message" ADD "suggestionState" character varying(256)`);
    await queryRunner.query(`ALTER TABLE "support_message" ADD "suggestionAuthorId" integer`);
    await queryRunner.query(`ALTER TABLE "support_message" ADD "suggestionCreated" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "support_message" ADD "suggestionHandledById" integer`);
    await queryRunner.query(`ALTER TABLE "support_message" ADD "suggestionHandled" TIMESTAMP`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "support_message" DROP COLUMN "suggestionHandled"`);
    await queryRunner.query(`ALTER TABLE "support_message" DROP COLUMN "suggestionHandledById"`);
    await queryRunner.query(`ALTER TABLE "support_message" DROP COLUMN "suggestionCreated"`);
    await queryRunner.query(`ALTER TABLE "support_message" DROP COLUMN "suggestionAuthorId"`);
    await queryRunner.query(`ALTER TABLE "support_message" DROP COLUMN "suggestionState"`);
    await queryRunner.query(`ALTER TABLE "support_message" DROP COLUMN "suggestionText"`);
  }
};
