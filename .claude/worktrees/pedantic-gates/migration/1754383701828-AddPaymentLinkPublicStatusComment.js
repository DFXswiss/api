const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddPaymentLinkPublicStatusComment1754383701828 {
    name = 'AddPaymentLinkPublicStatusComment1754383701828'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "publicStatus" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "comment" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "comment"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "publicStatus"`);
    }
}
