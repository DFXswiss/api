const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSortOrder1673383602546 {
    name = 'AddSortOrder1673383602546'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ADD "sortOrder" int`);
        await queryRunner.query(`ALTER TABLE "asset" ALTER COLUMN "uniqueName" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset" ALTER COLUMN "uniqueName" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "sortOrder"`);
    }
}
