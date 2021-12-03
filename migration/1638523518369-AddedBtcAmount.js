const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBtcAmount1638523518369 {
    name = 'AddedBtcAmount1638523518369'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "btcAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "btcAmount"`);
    }
}
