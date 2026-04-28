/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMrosReportFields1777101222447 {
    name = 'AddMrosReportFields1777101222447'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "mros" ADD "reportCode" nvarchar(256) NOT NULL CONSTRAINT "DF_34ee1d4c60de41c251fe14b9426" DEFAULT 'SAR'`);
        await queryRunner.query(`ALTER TABLE "mros" ADD "reason" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "mros" ADD "action" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "mros" ADD "indicators" nvarchar(MAX)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "indicators"`);
        await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "action"`);
        await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "reason"`);
        await queryRunner.query(`ALTER TABLE "mros" DROP CONSTRAINT "DF_34ee1d4c60de41c251fe14b9426"`);
        await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "reportCode"`);
    }
}
