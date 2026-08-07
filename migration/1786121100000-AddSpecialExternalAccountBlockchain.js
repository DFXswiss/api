/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `special_external_account.blockchain`: chain-binding for ScorechainExemptAddress rows.
 * Nullable because every other type does not use it; no backfill needed — no rows of this type
 * exist yet.
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSpecialExternalAccountBlockchain1786121100000 {
  name = 'AddSpecialExternalAccountBlockchain1786121100000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "special_external_account" ADD "blockchain" character varying(256)`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Fail loudly instead of silently widening released exemptions: without the column, the
    // rolled-back code matches these rows by address across ALL chains again.
    const [{ count }] = await queryRunner.query(
      `SELECT COUNT(*)::int AS "count" FROM "special_external_account" WHERE "type" = 'ScorechainExemptAddress'`,
    );
    if (count > 0)
      throw new Error(
        `Refusing to drop special_external_account.blockchain: ${count} ScorechainExemptAddress row(s) would lose their chain binding. Delete or archive these rows first.`,
      );

    await queryRunner.query(`ALTER TABLE "special_external_account" DROP COLUMN "blockchain"`);
  }
};
