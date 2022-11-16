const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddKycType1668150169114 {
    name = 'AddKycType1668150169114'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" ADD "kycType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "kycType"`);
    }
}
