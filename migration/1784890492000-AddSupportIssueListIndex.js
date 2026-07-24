/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportIssueListIndex1784890492000 {
    name = 'AddSupportIssueListIndex1784890492000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE INDEX "IDX_76abcde0ea067ebe7d01b6b285" ON "support_issue" ("department", "state", "created") `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_76abcde0ea067ebe7d01b6b285"`);
    }
}
