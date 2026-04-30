const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TransactionRequestFees1712139649720 {
    name = 'TransactionRequestFees1712139649720'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "fee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "minFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "dfxFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "networkFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "totalFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "totalFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "networkFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "dfxFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "minFee" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "fee" float NOT NULL`);
    }
}
