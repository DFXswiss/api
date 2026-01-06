const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserDataIsTrustedReferrer1767707453000 {
    name = 'AddUserDataIsTrustedReferrer1767707453000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "isTrustedReferrer" bit NOT NULL CONSTRAINT "DF_user_data_isTrustedReferrer" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP CONSTRAINT "DF_user_data_isTrustedReferrer"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "isTrustedReferrer"`);
    }
}
