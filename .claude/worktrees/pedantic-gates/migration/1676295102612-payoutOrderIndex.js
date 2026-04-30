const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class payoutOrderIndex1676295102612 {
    name = 'payoutOrderIndex1676295102612'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_2e398e934dbc29eea57a2f55ad" ON "payout_order" ("context", "correlationId") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_2e398e934dbc29eea57a2f55ad" ON "payout_order"`);
    }
}
