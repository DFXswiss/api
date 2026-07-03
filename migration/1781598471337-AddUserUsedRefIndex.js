/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserUsedRefIndex1781598471337 {
  name = 'AddUserUsedRefIndex1781598471337';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`CREATE INDEX "IDX_6b0462af56e2ba6802a9a2d062" ON "user" ("usedRef") `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_6b0462af56e2ba6802a9a2d062"`);
  }
};
