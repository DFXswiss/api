const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddNullableForwardFeeAmount1666880270785 {
    name = 'AddNullableForwardFeeAmount1666880270785'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "forwardFeeAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "forwardFeeAmount"`);
    }
}
