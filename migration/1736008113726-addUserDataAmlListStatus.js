const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataAmlListStatus1736008113726 {
    name = 'addUserDataAmlListStatus1736008113726'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "amlListStatus" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "amlListStatus"`);
    }
}
