const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoInputTxType1673605795897 {
    name = 'CryptoInputTxType1673605795897'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "txType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "txType"`);
    }
}
