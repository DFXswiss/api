const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedCustomerId1642166757868 {
    name = 'AddedCustomerId1642166757868'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycCustomerId" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycCustomerId"`);
    }
}
