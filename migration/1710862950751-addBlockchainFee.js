const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBlockchainFee1710862950751 {
    name = 'addBlockchainFee1710862950751'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "blockchainFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "blockchainFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "blockchainFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "blockchainFee"`);
    }
}
