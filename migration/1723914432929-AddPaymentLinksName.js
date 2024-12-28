const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddPaymentLinksName1723914432929 {
    name = 'AddPaymentLinksName1723914432929'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "paymentLinksName" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "paymentLinksName"`);
    }
}
