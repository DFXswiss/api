const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class changeAccountOpenerRelation1705932599781 {
    name = 'changeAccountOpenerRelation1705932599781'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "REL_8f119df333e0f6a70aac06f0d4" ON "dbo"."user_data"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_8f119df333e0f6a70aac06f0d4" ON "dbo"."user_data" ("accountOpenerId") WHERE ([accountOpenerId] IS NOT NULL)`);
    }
}
