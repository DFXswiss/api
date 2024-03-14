const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class BuyCryptoComment1710426805282 {
    name = 'BuyCryptoComment1710426805282'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "comment" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "comment"`);
    }
}
