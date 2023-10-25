const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CheckoutTxExpiresNullable1698078756376 {
    name = 'CheckoutTxExpiresNullable1698078756376'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ALTER COLUMN "expiresOn" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ALTER COLUMN "expiresOn" datetime2 NOT NULL`);
    }
}
