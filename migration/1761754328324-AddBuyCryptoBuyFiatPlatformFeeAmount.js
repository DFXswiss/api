/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBuyCryptoBuyFiatPlatformFeeAmount1761754328324 {
    name = 'AddBuyCryptoBuyFiatPlatformFeeAmount1761754328324'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" ADD "ownerId" int`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "usedPartnerRef" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "partnerFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "usedPartnerRef" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "partnerFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "user" ADD "partnerRefVolume" float NOT NULL CONSTRAINT "DF_1a5ab47a6107199fad3b55afb01" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "user" ADD "partnerRefCredit" float NOT NULL CONSTRAINT "DF_6ff0d03d287f896b917bb3d70ae" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "wallet" ADD CONSTRAINT "FK_9bf56f7989a7e5717c92221cce0" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "wallet" DROP CONSTRAINT "FK_9bf56f7989a7e5717c92221cce0"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_6ff0d03d287f896b917bb3d70ae"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "partnerRefCredit"`);
        await queryRunner.query(`ALTER TABLE "user" DROP CONSTRAINT "DF_1a5ab47a6107199fad3b55afb01"`);
        await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "partnerRefVolume"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "partnerFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "usedPartnerRef"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "partnerFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "usedPartnerRef"`);
        await queryRunner.query(`ALTER TABLE "wallet" DROP COLUMN "ownerId"`);
    }
}
