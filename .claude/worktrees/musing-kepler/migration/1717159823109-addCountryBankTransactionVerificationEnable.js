const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addCountryBankTransactionVerificationEnable1717159823109 {
    name = 'addCountryBankTransactionVerificationEnable1717159823109'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "bankTransactionVerificationEnable" bit NOT NULL CONSTRAINT "DF_563396ed14e75fb1ceeafc787b1" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP CONSTRAINT "DF_563396ed14e75fb1ceeafc787b1"`);
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "bankTransactionVerificationEnable"`);
    }
}
