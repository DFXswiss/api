const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddWalletMailConfig1749673095988 {
    name = 'AddWalletMailConfig1749673095988'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "mailConfig" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "mailConfig"`);
    }
}
