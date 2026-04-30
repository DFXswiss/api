const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class exchangeTxAddressMax1685745426886 {
    name = 'exchangeTxAddressMax1685745426886'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."exchange_tx" ALTER COLUMN "address" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."exchange_tx" ALTER COLUMN "address" nvarchar(256)`);
    }
}
