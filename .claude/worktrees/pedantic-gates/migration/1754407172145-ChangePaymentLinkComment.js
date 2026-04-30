const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangePaymentLinkComment1754407172145 {
    name = 'ChangePaymentLinkComment1754407172145'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "comment"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "comment" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "comment"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "comment" nvarchar(256)`);
    }
}
