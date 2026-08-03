/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds an idempotency key for API-generated KYC documents. Existing Sheet-generated files remain
 * untouched (NULL); a new workflow can create every document at most once per user and version.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddKycFileGenerationKey1785537000000 {
    name = 'AddKycFileGenerationKey1785537000000';

    /** @param {QueryRunner} queryRunner */
    async up(queryRunner) {
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`ALTER TABLE "kyc_file" ADD "generationKey" character varying(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_840d5653c5f3bc7c76de2d156d" ON "kyc_file" ("generationKey")`);
    }

    /** @param {QueryRunner} queryRunner */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_840d5653c5f3bc7c76de2d156d"`);
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP COLUMN "generationKey"`);
    }
};
