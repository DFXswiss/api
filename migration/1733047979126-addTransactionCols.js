const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionCols1733047979126 {
    name = 'addTransactionCols1733047979126'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "assets" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "amountInChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "eventDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "amlCheck" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "amlType" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" ADD "highRisk" bit`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "highRisk"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "amlType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "amlCheck"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "eventDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "amountInChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction" DROP COLUMN "assets"`);
    }
}
