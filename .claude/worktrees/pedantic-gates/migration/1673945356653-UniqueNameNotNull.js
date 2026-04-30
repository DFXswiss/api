const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UniqueNameNotNull1673945356653 {
    name = 'UniqueNameNotNull1673945356653'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "uniqueName" nvarchar(256) NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ALTER COLUMN "uniqueName" nvarchar(256)`);
    }
}
