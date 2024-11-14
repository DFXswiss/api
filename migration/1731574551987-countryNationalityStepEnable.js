const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class countryNationalityStepEnable1731574551987 {
    name = 'countryNationalityStepEnable1731574551987'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "nationalityStepEnable" bit NOT NULL CONSTRAINT "DF_cd305995e0a42f30dffcb0bdae9" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_cd305995e0a42f30dffcb0bdae9"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "nationalityStepEnable"`);
    }
}
