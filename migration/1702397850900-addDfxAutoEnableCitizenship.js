const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addDfxAutoEnableCitizenship1702397850900 {
    name = 'addDfxAutoEnableCitizenship1702397850900'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "nationalityEnable" bit NOT NULL CONSTRAINT "DF_c07dc76f654a325cc6cfb9c2553" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_c07dc76f654a325cc6cfb9c2553"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "nationalityEnable"`);
    }
}
