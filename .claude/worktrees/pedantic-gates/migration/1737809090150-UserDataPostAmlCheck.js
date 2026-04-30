const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class UserDataPostAmlCheck1737809090150 {
    name = 'UserDataPostAmlCheck1737809090150'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "postAmlCheck" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "postAmlCheck"`);
    }
}
