const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LiquidityOrderIndex1718702723340 {
    name = 'LiquidityOrderIndex1718702723340'

    async up(queryRunner) {
        await queryRunner.query(`CREATE INDEX "IDX_206c9ca4594e8eacae3600571f" ON "dbo"."liquidity_order" ("context", "correlationId") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_206c9ca4594e8eacae3600571f" ON "dbo"."liquidity_order"`);
    }
}
