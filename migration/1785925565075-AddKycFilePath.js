/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `kyc_file.path`, the full blob key of a catalogued document.
 *
 * The compliance tooling lists the documents of an account from `kyc_file` alone, which is why the KYC
 * documents of the Spider era are invisible today: they are stored under `spider/<userDataId>/…`
 * instead of the canonical `user/<userDataId>/<type>/<name>` layout the catalog assumes, and the 2024
 * backfill that created the catalog listed the `user/` prefix only. Those blobs cannot be moved or
 * copied into the canonical layout — the KYC container is WORM storage under a ten-year object lock —
 * so the column lets a row point at the blob where it already lies, which makes the documents visible
 * without touching the storage.
 *
 * Sized to the 1024 characters the storage allows for a key, so no existing blob can be too long to
 * record — a shorter column would fail the write for such a key instead of cataloguing it.
 *
 * The unique index is what keeps one blob to one row: the backfill checks the catalog before it writes,
 * and two overlapping runs — the full run takes minutes, long enough for a second one to be started —
 * would otherwise both pass that check and insert the same document twice, with no way to clean it up
 * other than a manual delete. It is partial so it constrains the catalogued blobs only.
 *
 * Nullable and null for every existing row: a row written by the upload path keeps resolving by
 * category, user, type and name, exactly as before, and is not covered by the index.
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddKycFilePath1785925565075 {
  name = 'AddKycFilePath1785925565075';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "kyc_file" ADD "path" character varying(1024)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_0845a9d7d4376e4cefeaa402ec" ON "kyc_file" ("path") WHERE "path" IS NOT NULL`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_0845a9d7d4376e4cefeaa402ec"`);
    await queryRunner.query(`ALTER TABLE "kyc_file" DROP COLUMN "path"`);
  }
};
