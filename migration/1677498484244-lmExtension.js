const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class lmExtension1677498484244 {
    name = 'lmExtension1677498484244'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" ADD "params" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD "previousActionId" int`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "previousOrderId" int`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "correlationId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "errorMessage" nvarchar(MAX)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a4d2566acf62d1e401f464d1a8" ON "liquidity_management_pipeline" ("ruleId", "status") WHERE status IN ('Created', 'InProgress')`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" ADD CONSTRAINT "FK_20d24dc1eaf1c4a9c6a78e6d6ad" FOREIGN KEY ("previousActionId") REFERENCES "liquidity_management_action"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP CONSTRAINT "FK_20d24dc1eaf1c4a9c6a78e6d6ad"`);
        await queryRunner.query(`DROP INDEX "IDX_a4d2566acf62d1e401f464d1a8" ON "liquidity_management_pipeline"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "errorMessage"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "correlationId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "previousOrderId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_pipeline" DROP COLUMN "previousActionId"`);
        await queryRunner.query(`ALTER TABLE "liquidity_management_action" DROP COLUMN "params"`);
    }
}
