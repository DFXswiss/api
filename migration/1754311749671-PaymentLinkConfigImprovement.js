/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PaymentLinkConfigImprovement1754311749671 {
    name = 'PaymentLinkConfigImprovement1754311749671'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP CONSTRAINT "FK_fcfee3e0c6edf65eb0795488393"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "name"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "street"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "houseNumber"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "zip"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "city"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "phone"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "mail"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "website"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "countryId"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "registrationNumber"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "storeType"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "merchantMcc"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "goodsType"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "goodsCategory"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "goodsCategory" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "goodsType" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "merchantMcc" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "storeType" int`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "registrationNumber" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "countryId" int`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "website" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "mail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "phone" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "city" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "zip" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "houseNumber" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "street" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "name" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD CONSTRAINT "FK_fcfee3e0c6edf65eb0795488393" FOREIGN KEY ("countryId") REFERENCES "country"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
