/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Backs the monthly bank-cost aggregation (BankTxService.getBankTxFee), which runs every minute from
 * the financial-log cron and filters bank_tx by (type = BANK_ACCOUNT_FEE, created >= from). Without a
 * matching composite index the query degrades to a full scan over a table that grows continuously.
 *
 * bank_tx carries no primary key in production (MSSQL->Postgres cutover drift), so this migration adds
 * ONLY a secondary index: no foreign key, no column alter, nothing that requires a unique constraint.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankTxTypeCreatedIndex1784117860216 {
  name = 'AddBankTxTypeCreatedIndex1784117860216';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`CREATE INDEX "IDX_bank_tx_type_created" ON "bank_tx" ("type", "created")`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_bank_tx_type_created"`);
  }
};
