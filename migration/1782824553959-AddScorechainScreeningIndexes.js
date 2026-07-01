/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Indexes for the scorechain_screening hot read paths: the per-screening cache lookup
 * (ScorechainScreeningService.getCached) filters on objectId/objectType/blockchain/analysisType
 * within a recent-created window, and the monthly quota guard (assertQuota) counts rows by created.
 * The table grows one row per screened crypto-in/out, so without these both queries degrade to
 * full scans over time.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddScorechainScreeningIndexes1782824553959 {
    name = 'AddScorechainScreeningIndexes1782824553959';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(
            `CREATE INDEX "IDX_scorechain_screening_lookup" ON "scorechain_screening" ("objectId", "objectType", "blockchain", "analysisType", "created")`,
        );
        await queryRunner.query(
            `CREATE INDEX "IDX_scorechain_screening_created" ON "scorechain_screening" ("created")`,
        );
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_scorechain_screening_created"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_scorechain_screening_lookup"`);
    }
};
