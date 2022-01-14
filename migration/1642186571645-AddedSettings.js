const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedSettings1642186571645 {
    name = 'AddedSettings1642186571645'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "settings" ("key" nvarchar(256) NOT NULL, "value" nvarchar(256) NOT NULL, CONSTRAINT "PK_c8639b7626fa94ba8265628f214" PRIMARY KEY ("key"))`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "settings"`);
    }
}
