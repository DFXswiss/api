const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataIndex1703646442636 {
    name = 'addUserDataIndex1703646442636'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_67ac648b1cda459c0207d3ad5f" ON "dbo"."user_data"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6e5a2daed16c3dd01f72a064cf" ON "dbo"."user_data" ("identDocumentId", "nationalityId", "accountType", "kycType") WHERE identDocumentId IS NOT NULL AND accountType IS NOT NULL AND kycType IS NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_6e5a2daed16c3dd01f72a064cf" ON "dbo"."user_data"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_67ac648b1cda459c0207d3ad5f" ON "dbo"."user_data" ("identDocumentId", "nationalityId") WHERE ([identDocumentId] IS NOT NULL)`);
    }
}
