const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataUniqueIndex1702567551022 {
    name = 'addUserDataUniqueIndex1702567551022'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_67ac648b1cda459c0207d3ad5f" ON "dbo"."user_data" ("identDocumentId", "nationalityId") WHERE identDocumentId IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_67ac648b1cda459c0207d3ad5f" ON "dbo"."user_data"`);
    }
}
