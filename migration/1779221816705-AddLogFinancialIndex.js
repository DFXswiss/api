/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLogFinancialIndex1779221816705 {
  name = 'AddLogFinancialIndex1779221816705';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Composite index to accelerate dashboard-financial queries:
    //   - getLatestFinancialLog (system/subsystem/severity, ORDER BY id DESC)
    //   - getFinancialLogs / getFinancialChangesLogs (range scans on created with daily/minute bucketing)
    //   - log-job.service.maxEntity lookups (every minute on the same predicates)
    // The log table grows by ~525k rows/year (one cron entry per minute), so a non-covered scan is expensive.
    await queryRunner.query(
      `CREATE INDEX "IDX_7765c3f5f663a0c6d250d28255" ON "log" ("subsystem", "severity", "created")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "IDX_7765c3f5f663a0c6d250d28255" ON "log"`);
  }
};
