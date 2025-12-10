const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addYapealEnable1765355681577 {
    name = 'addYapealEnable1765355681577'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "yapealEnable" bit NOT NULL CONSTRAINT "DF_yapealEnable" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_yapealEnable"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "yapealEnable"`);
    }
}
