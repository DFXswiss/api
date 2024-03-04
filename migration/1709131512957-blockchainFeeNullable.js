const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class blockchainFeeNullable1709131512957 {
    name = 'blockchainFeeNullable1709131512957'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" DROP COLUMN "outputReferenceAsset"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" DROP COLUMN "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."blockchain_fee" ALTER COLUMN "amount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."blockchain_fee" ALTER COLUMN "amount" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" ADD "outputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" ADD "outputReferenceAsset" nvarchar(256)`);
    }
}
