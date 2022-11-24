const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class indexLiquidityMgmtRule1669278810060 {
    name = 'indexLiquidityMgmtRule1669278810060'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0a5e225a822550676a0d49bb6f" ON "liquidity_management_rule" ("targetAssetId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8952855bd61ae683d3376d2f8b" ON "liquidity_management_rule" ("targetFiatId") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_8952855bd61ae683d3376d2f8b" ON "liquidity_management_rule"`);
        await queryRunner.query(`DROP INDEX "IDX_0a5e225a822550676a0d49bb6f" ON "liquidity_management_rule"`);
    }
}
