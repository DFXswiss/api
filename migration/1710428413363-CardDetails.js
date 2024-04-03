const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CardDetails1710428413363 {
    name = 'CardDetails1710428413363'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD "cardBin" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD "cardLast4" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD "cardIssuer" nvarchar(255)`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD "cardIssuerCountry" nvarchar(255)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP COLUMN "cardIssuerCountry"`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP COLUMN "cardIssuer"`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP COLUMN "cardLast4"`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP COLUMN "cardBin"`);
    }
}
