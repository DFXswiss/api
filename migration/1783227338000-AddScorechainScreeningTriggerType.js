/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddScorechainScreeningTriggerType1783227338000 {
    name = 'AddScorechainScreeningTriggerType1783227338000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "scorechain_screening" ADD "triggerType" character varying(256)`);
        // Existing rows predate the manual re-trigger — they were all written by the automated gate.
        await queryRunner.query(`UPDATE "scorechain_screening" SET "triggerType" = 'Automatic'`);
        await queryRunner.query(`ALTER TABLE "scorechain_screening" ALTER COLUMN "triggerType" SET NOT NULL`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "scorechain_screening" DROP COLUMN "triggerType"`);
    }
}
