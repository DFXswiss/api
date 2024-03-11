const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class checkoutTxApprovedNullable1710147158334 {
    name = 'checkoutTxApprovedNullable1710147158334'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ALTER COLUMN "approved" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ALTER COLUMN "approved" bit NOT NULL`);
    }
}
