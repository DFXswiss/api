const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addUserDataAmlListCols1734357833598 {
    name = 'addUserDataAmlListCols1734357833598'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "amlListExpiredDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "amlListReactivatedDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "amlListReactivatedDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "amlListExpiredDate"`);
    }
}
