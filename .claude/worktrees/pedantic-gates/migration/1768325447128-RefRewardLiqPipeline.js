/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RefRewardLiqPipeline1768325447128 {
    name = 'RefRewardLiqPipeline1768325447128'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD "liquidityPipelineId" int`);
        await queryRunner.query(`ALTER TABLE "ref_reward" ADD CONSTRAINT "FK_0bdf973ad618dffd7a7c6c53dc8" FOREIGN KEY ("liquidityPipelineId") REFERENCES "liquidity_management_pipeline"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP CONSTRAINT "FK_0bdf973ad618dffd7a7c6c53dc8"`);
        await queryRunner.query(`ALTER TABLE "ref_reward" DROP COLUMN "liquidityPipelineId"`);
    }
}
