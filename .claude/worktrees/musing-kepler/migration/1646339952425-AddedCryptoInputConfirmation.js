const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedCryptoInputConfirmation1646339952425 {
    name = 'AddedCryptoInputConfirmation1646339952425'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "isConfirmed" bit NOT NULL CONSTRAINT "DF_0d01b653b5fdf8175f90c937eb5" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_0d01b653b5fdf8175f90c937eb5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "isConfirmed"`);
    }
}
