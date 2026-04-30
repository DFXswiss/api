const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserDataModerator1746739483764 {
    name = 'AddUserDataModerator1746739483764'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "moderator" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "moderator"`);
    }
}
