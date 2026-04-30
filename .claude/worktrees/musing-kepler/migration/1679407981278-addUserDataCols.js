const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataCols1679407981278 {
    name = 'addUserDataCols1679407981278'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "letterSentDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "amlListAddedDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "amlListAddedDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "letterSentDate"`);
    }
}
