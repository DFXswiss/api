/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddYapealEurManualBank1768943778000 {
    name = 'AddYapealEurManualBank1768943778000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`
            INSERT INTO "bank" ("name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled", "assetId")
            VALUES ('Yapeal', 'CH8383019496938261612', 'YAPECHZ2', 'EUR', 0, 1, 0, 1, 405)
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "bank" WHERE "iban" = 'CH8383019496938261612'`);
    }
}
