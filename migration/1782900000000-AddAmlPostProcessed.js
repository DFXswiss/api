/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAmlPostProcessed1782900000000 {
    name = 'AddAmlPostProcessed1782900000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Existing rows were already post-processed under the previous logic, so they must read as done
        // (otherwise the new PASS-retry branch in doAmlCheck would re-process historical transactions).
        // Add the column with DEFAULT true — Postgres stores a constant default as metadata, so existing
        // rows are marked done without a full-table rewrite — then flip the default to false for new rows.
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "amlPostProcessed" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ALTER COLUMN "amlPostProcessed" SET DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "amlPostProcessed" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ALTER COLUMN "amlPostProcessed" SET DEFAULT false`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "amlPostProcessed"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "amlPostProcessed"`);
    }
}
