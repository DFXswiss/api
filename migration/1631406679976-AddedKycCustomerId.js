const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedKycCustomerId1631406679976 {
    name = 'AddedKycCustomerId1631406679976'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "kycCustomerId" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "kycCustomerId"`);
    }
}
