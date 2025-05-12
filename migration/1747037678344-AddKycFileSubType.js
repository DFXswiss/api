const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddKycFileSubType1747037678344 {
    name = 'AddKycFileSubType1747037678344'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_file" ADD "subType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."kyc_file" DROP COLUMN "subType"`);
    }
}
