const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyCryptoFeeExtension1678101398721 {
    name = 'buyCryptoFeeExtension1678101398721'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" ADD "allowedTotalFeePercent" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto_fee" DROP COLUMN "allowedTotalFeePercent"`);
    }
}
