const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addSiftResponse1718311906077 {
    name = 'addSiftResponse1718311906077'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."checkout_tx" ADD "authStatusReason" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" ADD "siftResponse" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ADD "siftResponse" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" DROP COLUMN "siftResponse"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" DROP COLUMN "siftResponse"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."checkout_tx" DROP COLUMN "authStatusReason"`);
    }
}
