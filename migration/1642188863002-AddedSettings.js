const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedSettings1642188863002 {
    name = 'AddedSettings1642188863002'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "setting" ("key" nvarchar(256) NOT NULL, "value" nvarchar(MAX) NOT NULL, CONSTRAINT "PK_1c4c95d773004250c157a744d6e" PRIMARY KEY ("key"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "setting"`);
    }
}
