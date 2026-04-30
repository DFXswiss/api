const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddUserDataPhoneCallCheckDate1756551743516 {
    name = 'AddUserDataPhoneCallCheckDate1756551743516'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "phoneCallCheckDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "phoneCallCheckDate"`);
    }
}
