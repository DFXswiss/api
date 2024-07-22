const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddDeactivationDate1721646752233 {
    name = 'AddDeactivationDate1721646752233'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "deactivationDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "deactivationDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "deactivationDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "deactivationDate"`);
    }
}
