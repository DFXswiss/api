const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddPaymentLinkStoreInfoCols1748340316200 {
    name = 'AddPaymentLinkStoreInfoCols1748340316200'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "regionManager" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "storeManager" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" ADD "storeOwner" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "storeOwner"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "storeManager"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payment_link" DROP COLUMN "regionManager"`);
    }
}
