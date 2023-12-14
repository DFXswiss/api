const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataUniqueIndex1702566053510 {
    name = 'addUserDataUniqueIndex1702566053510'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b9db2304624a5a201c2990d648" ON "dbo"."user_data" ("identDocumentId", "nationalityId") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_b9db2304624a5a201c2990d648" ON "dbo"."user_data"`);
    }
}
