const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveBankAccountIbanUniqueCondition1755692926267 {
    name = 'RemoveBankAccountIbanUniqueCondition1755692926267'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "iban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" DROP CONSTRAINT "UQ_1deee23ad14488afdae0bc92baa"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ADD CONSTRAINT "UQ_1deee23ad14488afdae0bc92baa" UNIQUE ("iban")`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_account" ALTER COLUMN "iban" nvarchar(256) NOT NULL`);
    }
}
