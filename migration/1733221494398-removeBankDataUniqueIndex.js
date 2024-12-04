const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeBankDataUniqueIndex1733221494398 {
    name = 'removeBankDataUniqueIndex1733221494398'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_254b6824b7059f39efb7631754" ON "dbo"."bank_data"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_254b6824b7059f39efb7631754" ON "dbo"."bank_data" ("iban", "userDataId") WHERE ([type]='User')`);
    }
}
