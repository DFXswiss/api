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
 * Nullable and null for every existing row: a row written by the upload path keeps resolving by
 * category, user, type and name, exactly as before.
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddKycFilePath1785925565075 {
    name = 'AddKycFilePath1785925565075'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_file" ADD "path" character varying(512)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP COLUMN "path"`);
    }
}
