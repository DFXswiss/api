/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Indexes for the compliance dashboard queries. Opening the dashboard fires ~11 queries that all
 * filter on unindexed columns and therefore run as sequential scans on Postgres: the call-queue
 * counters and pending-transaction list on buy_crypto/buy_fiat (amlCheck + amlReason), the
 * unavailable/suspicious call queue on user_data (phoneCallStatus) and the pending-review
 * summaries on kyc_step and bank_data (status).
 *
 * amlCheck leads the composite index so the many amlCheck-only queries of the AML process are
 * served by the same index; the kyc_step index leads with status for the same reason (the summary
 * filters status only, the per-step list filters both).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddComplianceDashboardIndexes1785218514041 {
    name = 'AddComplianceDashboardIndexes1785218514041';

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE INDEX "IDX_dcb295c7706d9c4012416f9434" ON "buy_crypto" ("amlCheck", "amlReason")`);
        await queryRunner.query(`CREATE INDEX "IDX_14ed0c9e651a60c38bb719a188" ON "buy_fiat" ("amlCheck", "amlReason")`);
        await queryRunner.query(`CREATE INDEX "IDX_d67d261c56b3ac23af98670719" ON "user_data" ("phoneCallStatus")`);
        await queryRunner.query(`CREATE INDEX "IDX_b24fbf2222de33d4529749fa30" ON "kyc_step" ("status", "name")`);
        await queryRunner.query(`CREATE INDEX "IDX_f484bd90944c931b1c38f624c7" ON "bank_data" ("status")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_f484bd90944c931b1c38f624c7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b24fbf2222de33d4529749fa30"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d67d261c56b3ac23af98670719"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_14ed0c9e651a60c38bb719a188"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dcb295c7706d9c4012416f9434"`);
    }
};
