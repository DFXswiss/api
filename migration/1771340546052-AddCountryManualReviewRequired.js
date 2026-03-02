/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCountryManualReviewRequired1771340546052 {
    name = 'AddCountryManualReviewRequired1771340546052'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" ADD "manualReviewRequired" bit NOT NULL CONSTRAINT "DF_e1a3302c583e7c2e4afcbe524f9" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "country" ADD "manualReviewRequiredOrganization" bit NOT NULL CONSTRAINT "DF_4852972602f8b5412de725340f9" DEFAULT 0`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_4852972602f8b5412de725340f9"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "manualReviewRequiredOrganization"`);
        await queryRunner.query(`ALTER TABLE "country" DROP CONSTRAINT "DF_e1a3302c583e7c2e4afcbe524f9"`);
        await queryRunner.query(`ALTER TABLE "country" DROP COLUMN "manualReviewRequired"`);
    }
}
