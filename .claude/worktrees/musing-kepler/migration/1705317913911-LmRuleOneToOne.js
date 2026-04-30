const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LmRuleOneToOne1705317913911 {
    name = 'LmRuleOneToOne1705317913911'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_537a870bbccc8d93123f8cefcc" ON "dbo"."liquidity_management_rule"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_537a870bbccc8d93123f8cefcc" ON "dbo"."liquidity_management_rule" ("targetAssetId") WHERE ([targetAssetId] IS NOT NULL)`);
    }
}
