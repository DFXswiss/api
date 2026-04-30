const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBanknameBIC1642202974459 {
    name = 'AddBanknameBIC1642202974459'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "bankname" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" ADD "bic" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "bic"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_data" DROP COLUMN "bankname"`);
    }
}
