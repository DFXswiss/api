const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class nullableFees1671536749610 {
    name = 'nullableFees1671536749610'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePurchaseFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePurchaseFeePercent" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePayoutFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePayoutFeePercent" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePayoutFeePercent" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePayoutFeeAmount" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePurchaseFeePercent" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ALTER COLUMN "estimatePurchaseFeeAmount" float NOT NULL`);
    }
}
