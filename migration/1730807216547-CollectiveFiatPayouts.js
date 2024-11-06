const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CollectiveFiatPayouts1730807216547 {
    name = 'CollectiveFiatPayouts1730807216547'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "REL_5669e232b56be7b85df413b784" ON "buy_fiat"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_5669e232b56be7b85df413b784" ON "buy_fiat" ("fiatOutputId") WHERE ([fiatOutputId] IS NOT NULL)`);
    }
}
