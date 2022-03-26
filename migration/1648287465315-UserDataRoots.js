const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserDataRoots1648287465315 {
    name = 'UserDataRoots1648287465315'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "riskRoots" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "riskRoots"`);
    }
}
