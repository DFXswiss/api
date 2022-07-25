const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class apiKeyCTUniqueIndex1658763007658 {
    name = 'apiKeyCTUniqueIndex1658763007658'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_94963fb28ad1772d4a1c9903c6" ON "dbo"."user" ("apiKeyCT") WHERE apiKeyCT IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_94963fb28ad1772d4a1c9903c6" ON "dbo"."user"`);
    }
}
