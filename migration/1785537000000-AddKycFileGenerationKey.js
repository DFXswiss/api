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
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dfx_kyc_file_generation_key" ON "kyc_file" ("generationKey")`);
    }

    /** @param {QueryRunner} queryRunner */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_dfx_kyc_file_generation_key"`);
        await queryRunner.query(`ALTER TABLE "kyc_file" DROP COLUMN "generationKey"`);
    }
};
