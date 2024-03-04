const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TxRequestFix1709154274442 {
    name = 'TxRequestFix1709154274442'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ALTER COLUMN "paymentRequest" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ALTER COLUMN "paymentRequest" nvarchar(255)`);
    }
}
