const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyFiatCryptoFee1681395711006 {
    name = 'buyFiatCryptoFee1681395711006'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "minFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "minFeeAmountFiat" float`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "totalFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "totalFeeAmountChf" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "minFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "minFeeAmountFiat" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "totalFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "totalFeeAmountChf" float`);

        

    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "totalFeeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "totalFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "minFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "minFeeAmountFiat"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "totalFeeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "totalFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "minFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "minFeeAmountFiat"`);
    }
}
