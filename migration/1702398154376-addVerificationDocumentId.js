const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addVerificationDocumentId1702398154376 {
    name = 'addVerificationDocumentId1702398154376'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "verificationDocumentId" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "verificationDocumentId"`);
    }
}
