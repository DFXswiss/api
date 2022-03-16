const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedUserOrigin1647349398970 {
    name = 'AddedUserOrigin1647349398970'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "origin" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ADD "origin" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ALTER COLUMN "ref" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."ref" ALTER COLUMN "ref" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref" DROP COLUMN "origin"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "origin"`);
    }
}
