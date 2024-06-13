const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addSiftResponse1718306376367 {
    name = 'addSiftResponse1718306376367'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."checkout_tx" ADD "authStatusReason" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" ADD "siftResponse" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ADD "siftResponse" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ALTER COLUMN "status" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" DROP CONSTRAINT "DF_d5c231478ed12f258caacfa4b9d"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ADD CONSTRAINT "DF_d5c231478ed12f258caacfa4b9d" DEFAULT 'Created' FOR "status"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ALTER COLUMN "status" nvarchar(256) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" DROP COLUMN "siftResponse"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" DROP COLUMN "siftResponse"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."checkout_tx" DROP COLUMN "authStatusReason"`);
    }
}
