const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class lmExtension1677246971079 {
    name = 'lmExtension1677246971079'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" ADD "params" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "correlationId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "errorMessage" nvarchar(MAX)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a4d2566acf62d1e401f464d1a8" ON "liquidity_management_pipeline" ("ruleId", "status") WHERE status IN ('Created', 'InProgress')`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_a4d2566acf62d1e401f464d1a8" ON "liquidity_management_pipeline"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "errorMessage"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "correlationId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" DROP COLUMN "params"`);
    }
}
