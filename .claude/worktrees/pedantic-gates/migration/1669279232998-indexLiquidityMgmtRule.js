const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class indexLiquidityMgmtRule1669279232998 {
    name = 'indexLiquidityMgmtRule1669279232998'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_537a870bbccc8d93123f8cefcc" ON "liquidity_management_rule" ("targetAssetId") WHERE targetAssetId IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_997dd275fb7995cb15e47771cf" ON "liquidity_management_rule" ("targetFiatId") WHERE targetFiatId IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_997dd275fb7995cb15e47771cf" ON "liquidity_management_rule"`);
        await queryRunner.query(`DROP INDEX "IDX_537a870bbccc8d93123f8cefcc" ON "liquidity_management_rule"`);
    }
}
